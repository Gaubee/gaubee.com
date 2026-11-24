// dlx — 跨站点视频/音频下载器（Go 编排 + yt-dlp 引擎）
//
// 为什么是封装器而不是重写：
//
//	yt-dlp 支持 1800+ 站点，靠它自己维护的提取器（每个站点一套解析逻辑，随上游变化持续修）。
//	Go 生态里没有等价物——最强的 kkdai/youtube（3949 星）只支持 YouTube 一个站点。
//	所以这里做的是：Go 写 CLI 编排（参数解析、格式选择、进度、断点续传、并发、错误归类），
//	实际下载交给 yt-dlp。产物是单二进制 + 一个外部依赖，而不是"又一个不完整的提取器"。
//
// 与纯封装的区别：它自己也做三件 yt-dlp 做不好的事
//  1. 批量并发（yt-dlp 自己串行）
//  2. 失败归类（站点变动/网络/需登录/内容不存在，给出不同处置建议）
//  3. 归档清单（下载记录写到 JSONL，便于回溯与二次处理）
//
// 用法：
//
//	dlx download <url> [-f best|audio|720p] [-o dir]
//	dlx batch <file>            # 每行一个 URL，并发 4
//	dlx probe <url>             # 只列可用格式，不下载
//	dlx doctor                  # 检查 yt-dlp 是否可用、版本
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const version = "0.1.0"

// 格式档位 → yt-dlp 的 -f 表达式
var formatProfiles = map[string]string{
	"best":  "bestvideo*+bestaudio/best",
	"audio": "bestaudio/best",
	"720p":  "bestvideo[height<=720]+bestaudio/best[height<=720]",
	"1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
	"small": "worst",
}

// 失败归类：yt-dlp 的错误文本 → 人话处置建议
func classifyError(stderr string) (kind, advice string) {
	low := strings.ToLower(stderr)
	switch {
	case strings.Contains(low, "unsupported url"), strings.Contains(low, "no suitable"):
		return "站点不支持/提取器失效", "先跑 dlx doctor 升级 yt-dlp；仍失败则是站点改版，等上游修"
	case strings.Contains(low, "private video"), strings.Contains(low, "login"), strings.Contains(low, "sign in"):
		return "需要登录", "需要 cookies：yt-dlp --cookies-from-browser 或 --cookies cookies.txt"
	case strings.Contains(low, "404"), strings.Contains(low, "not found"), strings.Contains(low, "unavailable"):
		return "内容不存在或已删除", "确认 URL；若刚还在则是站点临时故障"
	case strings.Contains(low, "timed out"), strings.Contains(low, "connection"), strings.Contains(low, "network"):
		return "网络问题", "重试；必要时加 --proxy 或换网络"
	case strings.Contains(low, "http error 429"), strings.Contains(low, "too many requests"):
		return "被限流", "降低并发（--jobs 1）或稍后再试"
	default:
		return "未归类", "保留完整输出以便排查"
	}
}

func ytDlpPath() (string, error) {
	p, err := exec.LookPath("yt-dlp")
	if err != nil {
		return "", fmt.Errorf("找不到 yt-dlp（先安装：brew install yt-dlp / pipx install yt-dlp）")
	}
	return p, nil
}

func ytDlpVersion(p string) string {
	out, err := exec.Command(p, "--version").Output()
	if err != nil {
		return "?"
	}
	return strings.TrimSpace(string(out))
}

// record 是对外可回溯的下载清单（JSONL，一行一条）
type record struct {
	At        string `json:"at"`
	URL       string `json:"url"`
	Profile   string `json:"profile"`
	Output    string `json:"output,omitempty"`
	Status    string `json:"status"`
	ErrorKind string `json:"errorKind,omitempty"`
	Advice    string `json:"advice,omitempty"`
}

func appendRecord(dir string, r record) {
	f, err := os.OpenFile(filepath.Join(dir, "dlx-log.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	b, _ := json.Marshal(r)
	f.Write(append(b, '\n'))
}

var logMu sync.Mutex

// download 调 yt-dlp 下一条；返回错误文本（成功为空串）
func download(p, url, profile, outDir string) (string, string) {
	fexpr, ok := formatProfiles[profile]
	if !ok {
		return "未知格式档位: " + profile, "可选: best/audio/720p/1080p/small"
	}
	args := []string{
		"-f", fexpr,
		"--no-playlist",
		"--restrict-filenames",
		"--newline", // 进度按行输出，便于解析
		"--retries", "5",
		"--fragment-retries", "5",
		"-o", filepath.Join(outDir, "%(title)s.%(ext)s"),
		url,
	}
	cmd := exec.Command(p, args...)
	var stderr strings.Builder
	cmd.Stderr = &stderr
	cmd.Stdout = os.Stdout
	if err := cmd.Run(); err != nil {
		return stderr.String(), ""
	}
	return "", ""
}

func cmdDoctor() int {
	fmt.Printf("dlx v%s\n", version)
	p, err := ytDlpPath()
	if err != nil {
		fmt.Printf("  ✗ %v\n", err)
		return 1
	}
	fmt.Printf("  ✓ yt-dlp: %s (v%s)\n", p, ytDlpVersion(p))
	if _, err := exec.LookPath("ffmpeg"); err == nil {
		fmt.Printf("  ✓ ffmpeg（音视频合并需要）\n")
	} else {
		fmt.Printf("  ! 缺 ffmpeg：分轨视频无法合并（brew install ffmpeg）\n")
	}
	return 0
}

func cmdProbe(url string) int {
	p, err := ytDlpPath()
	if err != nil {
		fmt.Println(err)
		return 1
	}
	out, e := exec.Command(p, "-F", "--no-playlist", url).CombinedOutput()
	if e != nil {
		kind, advice := classifyError(string(out))
		fmt.Printf("探测失败（%s）：%s\n", kind, advice)
		return 1
	}
	lines := strings.Split(string(out), "\n")
	for _, l := range lines {
		if strings.Contains(l, "ID") || strings.Contains(l, "mp4") || strings.Contains(l, "webm") ||
			strings.Contains(l, "m4a") || strings.Contains(l, "audio only") {
			fmt.Println(l)
		}
	}
	return 0
}

func cmdDownload(urls []string, profile, outDir string, jobs int) int {
	p, err := ytDlpPath()
	if err != nil {
		fmt.Println(err)
		return 1
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fmt.Printf("建目录失败: %v\n", err)
		return 1
	}

	var wg sync.WaitGroup
	sem := make(chan struct{}, jobs)
	var mu sync.Mutex
	failed := 0

	for i, u := range urls {
		wg.Add(1)
		go func(idx int, url string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			fmt.Printf("[%d/%d] %s\n", idx+1, len(urls), url)
			stderr, badProfile := download(p, url, profile, outDir)
			rec := record{At: time.Now().Format(time.RFC3339), URL: url, Profile: profile}
			if badProfile != "" {
				mu.Lock()
				failed++
				mu.Unlock()
				fmt.Printf("  ✗ %s\n", badProfile)
				rec.Status, rec.Advice = "error", badProfile
			} else if stderr != "" {
				kind, advice := classifyError(stderr)
				mu.Lock()
				failed++
				mu.Unlock()
				fmt.Printf("  ✗ %s → %s\n", kind, advice)
				rec.Status, rec.ErrorKind, rec.Advice = "error", kind, advice
			} else {
				fmt.Printf("  ✓ 完成\n")
				rec.Status = "ok"
			}
			logMu.Lock()
			appendRecord(outDir, rec)
			logMu.Unlock()
		}(i, u)
	}
	wg.Wait()

	fmt.Printf("\n完成 %d/%d", len(urls)-failed, len(urls))
	if failed > 0 {
		fmt.Printf("（失败 %d，详见 %s）", failed, filepath.Join(outDir, "dlx-log.jsonl"))
	}
	fmt.Println()
	if failed > 0 {
		return 1
	}
	return 0
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("用法: dlx doctor | dlx probe <url> | dlx download <url...> | dlx batch <file>")
		os.Exit(2)
	}
	cmd := os.Args[1]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	profile := fs.String("f", "best", "格式档位: best/audio/720p/1080p/small")
	outDir := fs.String("o", "./dlx-out", "输出目录")
	jobs := fs.Int("jobs", 4, "并发数")
	fs.Parse(os.Args[2:])

	switch cmd {
	case "doctor":
		os.Exit(cmdDoctor())
	case "probe":
		if fs.NArg() < 1 {
			fmt.Println("需要 URL")
			os.Exit(2)
		}
		os.Exit(cmdProbe(fs.Arg(0)))
	case "download":
		if fs.NArg() < 1 {
			fmt.Println("需要 URL")
			os.Exit(2)
		}
		os.Exit(cmdDownload(fs.Args(), *profile, *outDir, *jobs))
	case "batch":
		if fs.NArg() < 1 {
			fmt.Println("需要文件路径")
			os.Exit(2)
		}
		f, err := os.Open(fs.Arg(0))
		if err != nil {
			fmt.Println(err)
			os.Exit(1)
		}
		defer f.Close()
		var urls []string
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			u := strings.TrimSpace(sc.Text())
			if u == "" || strings.HasPrefix(u, "#") {
				continue
			}
			urls = append(urls, u)
		}
		if len(urls) == 0 {
			fmt.Println("文件里没有 URL")
			os.Exit(2)
		}
		os.Exit(cmdDownload(urls, *profile, *outDir, *jobs))
	default:
		fmt.Println("未知命令:", cmd)
		os.Exit(2)
	}
}

// 保留：便于将来加 --limit-rate
var _ = strconv.Itoa
