# ssh-channel-doctor — gaubee-cloud ssh 通道检查

## 是什么

lag-watch 的前置早警：一条命令把服务器 ssh 通道健康做成门禁——known_hosts 快检、kaku 包装实现文件在位确认、BatchMode 免交互试连（决定性证据）。全绿才跑 lag-watch，避免每次部署收敛先撞一次红。`--fix` 对「Host key verification failed」做 keyscan 补录（TOFU）并复测。

## 解决什么

2026-10-25/26 连续实证的两类通道故障：known_hosts 被外部进程清理（补录后次日又被冲）、kaku ssh 包装函数在非交互 shell 缺失（`_kaku_wrapped_ssh` 未定义）。这些失败每次都要现场排查 5-10 分钟；工具把判据固化。

## 怎么跑

```bash
bun tools/2026-10-30-ssh-channel-doctor/ssh-channel-doctor.ts            # 快检（只读）
bun tools/2026-10-30-ssh-channel-doctor/ssh-channel-doctor.ts --fix      # 键缺失时补录
```

## 真实示例输出（2026-10-30 首跑，exit 0）

```text
known_hosts 快检：文件在（非 hashed 匹配 0 条）
kaku 包装：实现文件在（非交互 shell 需 source 后使用）
试连：OK（BatchMode 免交互连通）
通道健康：可以跑 lag-watch / 服务器侧验收
```

（「非 hashed 匹配 0 条」说明 known_hosts 走 hashed 条目，预检仅供参考；连通性以试连为准。）

## 边界

- `--fix` 是 TOFU：补录前该 IP 的可信度由「文档化服务器地址 + TLS 直连可验证」背书，补录后仍需 kzf 复核键指纹。
- 只诊断 ssh 通道；manifest 同步与 token 健康是 lag-watch 的职责，不在本工具范围。
