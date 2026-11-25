# 工具形态清单（FORM-INVENTORY）

> 2026-11-23 由 `tools/gen-form-inventory` 一次性生成。形态定义见 `openspec/changes/tool-body-economy`。
> **internal 的工具不占体力、不进登记簿**——它们的唯一消费者是每日维护任务本身。

分布：webapp 12 / self-hosted 9 / internal 79（共 100）

| 工具目录 | form | 说明 | 用途 |
| --- | --- | --- | --- |
| 2026-10-03-stale-check | webapp | 收藏保鲜检查（archived/长期未推送），数据可公开 | stale-check |
| 2026-10-03-stars-search | webapp | 按关键词检索收藏，数据可公开（仓库名与描述本就是公开信息） | stars-search |
| 2026-10-04-deps-why | webapp | 依赖溯源：我在哪里用的 X，数据可公开 | deps-why |
| 2026-10-04-star-at | webapp | 收藏序号查询，可与 star-timeline 合并 | star-at |
| 2026-10-05-x-media-audit | internal | 只服务每日维护管道（自动判定） | x-media-audit |
| 2026-10-05-x-search | webapp | X 动态检索，但数据含私有判断 → 只投影公开字段时可用 | x-search |
| 2026-10-07-event-frontmatter-lint | internal | 只服务每日维护管道（自动判定） | event-frontmatter-lint |
| 2026-10-07-manifest-lint | internal | 只服务每日维护管道（自动判定） | manifest-lint |
| 2026-10-08-ci-duration-trends | internal | 只服务每日维护管道（自动判定） | ci-duration-trends |
| 2026-10-08-taxonomy-count-doctor | internal | 只服务每日维护管道（自动判定） | taxonomy-count-doctor |
| 2026-10-09-pipeline-env-doctor | internal | 管道环境自检，维护自身前置 | pipeline-env-doctor |
| 2026-10-09-x-time0-migration | self-hosted | 一次性媒体路径迁移，需本地 staging | x-time0-migration |
| 2026-10-09-x-window-entries | internal | 只服务每日维护管道（自动判定） | x-window-entries |
| 2026-10-10-patch-precheck | internal | 只服务每日维护管道（自动判定） | patch-precheck |
| 2026-10-10-translations-doctor | internal | 只服务每日维护管道（自动判定） | translations-doctor |
| 2026-10-11-avatar-healthcheck | internal | 只服务每日维护管道（自动判定） | avatar-healthcheck |
| 2026-10-11-x-daily-backfill | internal | 只服务每日维护管道（自动判定） | x-daily-backfill |
| 2026-10-12-report-window-guard | internal | 只服务每日维护管道（自动判定） | report-window-guard |
| 2026-10-12-staging-forecast | internal | 只服务每日维护管道（自动判定） | staging-forecast |
| 2026-10-13-ai-tone-one | internal | 只服务每日维护管道（自动判定） | ai-tone-one |
| 2026-10-13-deploy-smoke | internal | 只服务每日维护管道（自动判定） | deploy-smoke |
| 2026-10-14-deps-digest | webapp | 依赖变更人话化，可与 deps-why 合并 | deps-digest |
| 2026-10-14-event-date-anchor | internal | 只服务每日维护管道（自动判定） | event-date-anchor |
| 2026-10-14-git-ahead-guard | internal | 只服务每日维护管道（自动判定） | git-ahead-guard |
| 2026-10-15-daily-digest | internal | 只服务每日维护管道（自动判定） | daily-digest |
| 2026-10-15-manifest-lag-watch | internal | 只服务每日维护管道（自动判定） | manifest-lag-watch |
| 2026-10-16-deps-jitter-report | internal | 只服务每日维护管道（自动判定） | deps-jitter-report |
| 2026-10-16-token-swap-apply | self-hosted | CDN token 更换，涉及凭据与服务器 | token-swap-apply |
| 2026-10-17-deps-jitter-probe | internal | 只服务每日维护管道（自动判定） | deps-jitter-probe |
| 2026-10-17-star-flow-weekly | webapp | 星标兴趣周流向，可与 star-timeline 合并 | star-flow-weekly |
| 2026-10-18-cron-day-briefing | internal | 只服务每日维护管道（自动判定） | cron-day-briefing |
| 2026-10-18-t1-window-guard | internal | 只服务每日维护管道（自动判定） | t1-window-guard |
| 2026-10-19-media-meta-freshness | internal | 只服务每日维护管道（自动判定） | media-meta-freshness |
| 2026-10-19-oauth-flow-smoke | internal | 只服务每日维护管道（自动判定） | oauth-flow-smoke |
| 2026-10-20-auth-server-deploy | self-hosted | auth-server 部署器，需要服务器凭据 | auth-server-deploy |
| 2026-10-20-video-retro-hd | self-hosted | 需要 ffmpeg 与本地 cdn-media staging，无法在浏览器跑 | video-retro-hd |
| 2026-10-20-x-posters-backfill | self-hosted | 需要本地媒体库与 X 抓取 | x-posters-backfill |
| 2026-10-21-hls-live-check | internal | 只服务每日维护管道（自动判定） | hls-live-check |
| 2026-10-22-cdn-usage-report | internal | 只服务每日维护管道（自动判定） | cdn-usage-report |
| 2026-10-22-x-session-probe | internal | 只服务每日维护管道（自动判定） | x-session-probe |
| 2026-10-23-retro-status | internal | 只服务每日维护管道（自动判定） | retro-status |
| 2026-10-23-xd-window-audit | internal | 只服务每日维护管道（自动判定） | xd-window-audit |
| 2026-10-24-trans-quality-sampler | internal | 只服务每日维护管道（自动判定） | trans-quality-sampler |
| 2026-10-24-x-thread-backfill | self-hosted | 需要 X 登录态与 syndication 抓取 | x-thread-backfill |
| 2026-10-25-stars-drift | webapp | 兴趣漂移月览，可与 star-timeline 合并 | stars-drift |
| 2026-10-25-vault-verify | self-hosted | vault 完整性校验，必须读本地加密库 | vault-verify |
| 2026-10-26-vault-drift-sync | self-hosted | vault 漂移回灌，必须写本地加密库 | vault-drift-sync |
| 2026-10-26-x-top-authors | webapp | X 点赞作者榜，只含公开账号 | x-top-authors |
| 2026-10-27-data-write | internal | 私有数据安全写包装，维护管线内部件 | data-write |
| 2026-10-27-pipeline-gap-check | internal | 只服务每日维护管道（自动判定） | pipeline-gap-check |
| 2026-10-28-remux-probe | self-hosted | 本地媒体无损重封装探针，需要 ffmpeg | remux-probe |
| 2026-10-28-trans-tco-scrub | internal | 只服务每日维护管道（自动判定） | trans-tco-scrub |
| 2026-10-29-star-readme | webapp | 仓库 README 首屏速览，需网络但可在浏览器直连 GitHub | star-readme |
| 2026-10-29-x-archive-coverage | internal | 只服务每日维护管道（自动判定） | x-archive-coverage |
| 2026-10-30-commits-digest | internal | 只服务每日维护管道（自动判定） | commits-digest |
| 2026-10-30-ssh-channel-doctor | internal | 只服务每日维护管道（自动判定） | ssh-channel-doctor |
| 2026-10-31-llm-mem-fit | webapp | 端侧 LLM 内存估算，纯计算无数据依赖 | llm-mem-fit |
| 2026-10-31-registry-digest | internal | 工坊待裁决清单汇总，服务工坊自身 | registry-digest |
| 2026-11-04-catchup-scan | internal | 只服务每日维护管道（自动判定） | catchup-scan |
| 2026-11-04-x-daily-guard | internal | 只服务每日维护管道（自动判定） | x-daily-guard |
| 2026-11-05-cdn-cache-doctor | internal | 只服务每日维护管道（自动判定） | cdn-cache-doctor |
| 2026-11-05-star-timeline | webapp | 收藏时间线与累计，权威口径，适合做成时间轴视图 | star-timeline |
| 2026-11-06-media-unref-report | internal | 只服务每日维护管道（自动判定） | media-unref-report |
| 2026-11-06-report-lint | internal | 只服务每日维护管道（自动判定） | report-lint |
| 2026-11-07-vol-name-plan | internal | 只服务每日维护管道（自动判定） | vol-name-plan |
| 2026-11-07-x-daily-trans-coverage | internal | 只服务每日维护管道（自动判定） | x-daily-trans-coverage |
| 2026-11-08-nav-effect-lint | internal | 只服务每日维护管道（自动判定） | nav-effect-lint |
| 2026-11-08-x-daily-thread-gaps | internal | 只服务每日维护管道（自动判定） | x-daily-thread-gaps |
| 2026-11-09-stars-integrity-audit | internal | 只服务每日维护管道（自动判定） | stars-integrity-audit |
| 2026-11-09-x-daily-staleness | internal | 只服务每日维护管道（自动判定） | x-daily-staleness |
| 2026-11-10-repo-rename-reconciler | internal | 只服务每日维护管道（自动判定） | repo-rename-reconciler |
| 2026-11-10-weekly-digest | internal | 只服务每日维护管道（自动判定） | weekly-digest |
| 2026-11-11-event-number-audit | internal | 只服务每日维护管道（自动判定） | event-number-audit |
| 2026-11-11-privacy-audit | internal | 只服务每日维护管道（自动判定） | privacy-audit |
| 2026-11-12-report-commit-count-audit | internal | 只服务每日维护管道（自动判定） | report-commit-count-audit |
| 2026-11-12-taxonomy-dedupe | internal | 只服务每日维护管道（自动判定） | taxonomy-dedupe |
| 2026-11-14-backfill-plan | internal | 只服务每日维护管道（自动判定） | backfill-plan |
| 2026-11-14-pipeline-completeness-audit | internal | 只服务每日维护管道（自动判定） | pipeline-completeness-audit |
| 2026-11-15-rename-impact-audit | internal | 只服务每日维护管道（自动判定） | rename-impact-audit |
| 2026-11-15-x-daily-rundate-check | internal | 只服务每日维护管道（自动判定） | x-daily-rundate-check |
| 2026-11-16-staging-clean-preview | internal | 只服务每日维护管道（自动判定） | staging-clean-preview |
| 2026-11-16-star-cumulative-attribution | internal | 只服务每日维护管道（自动判定） | star-cumulative-attribution |
| 2026-11-17-ai-tone-locate | internal | 只服务每日维护管道（自动判定） | ai-tone-locate |
| 2026-11-17-taxo-note-guard | internal | 只服务每日维护管道（自动判定） | taxo-note-guard |
| 2026-11-18-commit-workflow-groups | internal | 只服务每日维护管道（自动判定） | commit-workflow-groups |
| 2026-11-18-morning-brief | internal | 只服务每日维护管道（自动判定） | morning-brief |
| 2026-11-19-report-facts-check | internal | 只服务每日维护管道（自动判定） | report-facts-check |
| 2026-11-19-taxonomy-coverage-audit | internal | 只服务每日维护管道（自动判定） | taxonomy-coverage-audit |
| 2026-11-20-pipeline-facts | internal | 只服务每日维护管道（自动判定） | pipeline-facts |
| 2026-11-20-rename-similarity-audit | internal | 只服务每日维护管道（自动判定） | rename-similarity-audit |
| 2026-11-21-event-sync-check | internal | 只服务每日维护管道（自动判定） | event-sync-check |
| 2026-11-21-late-star-backfill | internal | 只服务每日维护管道（自动判定） | late-star-backfill |
| 2026-11-22-site-endpoint-doctor | internal | 只服务每日维护管道（自动判定） | site-endpoint-doctor |
| 2026-11-22-stale-out-guard | internal | 只服务每日维护管道（自动判定） | stale-out-guard |
| 2026-11-23-ai-tone-explain | internal | 只服务每日维护管道（自动判定） | ai-tone-explain |
| 2026-11-23-weekly-theme-signals | internal | 只服务每日维护管道（自动判定） | weekly-theme-signals |
| 2026-11-24-star-browse | internal | 只服务每日维护管道（自动判定） | star-browse |
| 2026-11-24-tech-adoption | internal | 只服务每日维护管道（自动判定） | tech-adoption |
| 2026-11-25-gate-consistency-audit | internal | 只服务每日维护管道（自动判定） | gate-consistency-audit |
| 2026-11-25-star-x-cross | internal | 只服务每日维护管道（自动判定） | star-x-cross |

## 迁移动作

- `internal`：从 `REGISTRY.md` 移出，列入本文档；不占体力。
- `webapp`：数据投影到 `static/tools/data/`，在 `/app/tools` 下提供界面。
- `self-hosted`：README 补部署段；允许建 `gaubee-tool-<slug>` 仓库分发。
