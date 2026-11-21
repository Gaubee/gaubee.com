# site-endpoint-doctor — 站点入口体检

## 是什么

一次查清五件事：DNS 现在指向哪个 IP、这个 IP 的 80/443 是否直连可达、TLS 证书归谁签还有多久到期、
首页与最新 event 页的返回、以及（可选）边缘与源站对同一路径的返回是否一致。

## 解决什么

2026-11-22 实证：`gaubee.com` 一周内换过两次地址（北京 → 香港 → 新入口 `118.26.39.57`）。
工具里写死的旧 IP 让 HLS、部署冒烟、页面探针连续三天报「媒体 404 / TLS 不可达」，
看着像站点挂了，实际只是钉子钉在了旧地址。人工排查的第一步也只能是这几件事，
但每件都要单独敲一条命令，还容易漏（比如证书到期时间）。

## 怎么跑

```bash
bun tools/2026-11-22-site-endpoint-doctor/site-endpoint-doctor.ts
bun tools/2026-11-22-site-endpoint-doctor/site-endpoint-doctor.ts --ssh gaubee-cloud
```

退出码：0 = 入口可用；1 = 有硬问题（直连不通 / 证书过期 / 页面异常）；2 = 解析失败。

## 真实示例输出（2026-11-22）

```text
site-endpoint-doctor：gaubee.com
  当前 A 记录：118.26.39.57
  直连 443：200　直连 80：301
  subject= /CN=gaubee.com
  issuer= /C=US/O=Let's Encrypt/CN=YE2
  notAfter=Jan 12 15:02:18 2027 GMT
  证书剩余 51 天
  首页字节：4555（SPA 壳通常约 4.5KB）
  最新 event 01923.github-daily-2026-11-20：200 16496
  /cdn-media/current.json　边缘 4555B vs 源站 4555B

ENDPOINT OK：入口可用
```

## 判读建议

- 第 2 行 443 不通时先别怀疑站点：确认是不是换了入口（第 1 行）、或该 IP 只接受特定 SNI / 只对 CDN 开放。
- 「边缘 vs 源站」两边都是 4555B 说明该路径被 SPA 回退接住了，不是内容不一致；媒体对象按 `/cdn-media/x/...` 单独验。
- 站点工具（HLS、部署冒烟）现在都走 DoH 动态解析，不再依赖这里手工填 IP；本工具的用途是出问题时定性。
- 证书剩余少于 14 天会在输出里标「该续了」。
