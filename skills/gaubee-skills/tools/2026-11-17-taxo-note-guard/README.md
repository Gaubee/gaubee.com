# taxo-note-guard — 链接位自洽检查（注释里提历史名是允许的）

## 是什么

扫 taxonomy 里所有 `- [owner/name](https://github.com/owner/name)` 形态的链接位，
检查**链接文字与 URL 是否指向同一个仓库**。注释与说明文字里提到的历史名不计入。

## 解决什么

2026-11-17 的实例：`rename-impact-audit` 按仓库全名扫全文，判断是否还引用旧名。
我为可追溯在条目里写了「（原 google/gvisor，已迁组织）」，结果被判为「taxonomy 仍引用旧名」，
从绿转红。工具没写错——它无法区分「用作说明的历史名」和「仍当作有效地址的旧名」。

本工具补上这个区分：只有**链接位**指向旧地址才是真错误。注释里写「原 owner/name」
是有价值的历史信息，不该被当成违规。

## 与 rename-impact-audit 的分工

| 工具 | 管什么 |
| --- | --- |
| `rename-impact-audit` | 改名影响面：哪些历史报告和已发布 event 还引用旧名 |
| `taxo-note-guard` | 链接位自洽：taxonomy 的链接文字与 URL 是否一致 |

两者互补：前者会因注释里的历史名报警（需要人判断），后者只报链接位的真实不一致。

## 怎么跑

```bash
bun tools/2026-11-17-taxo-note-guard/taxo-note-guard.ts
bun tools/2026-11-17-taxo-note-guard/taxo-note-guard.ts --json
```

退出码：0 = 链接位全部自洽；1 = 有链接文字与 URL 不一致；2 = taxonomy 缺失。只读。

## 真实示例输出（2026-11-17）

```text
taxonomy 链接位体检：158 个仓库链接（注释与正文里的历史名不计）
TAXO NOTE OK：所有链接文字与 URL 指向同一仓库
提示：条目说明里写「原 owner/name」是允许的，不会影响本检查。
```

## 判读建议

- 报 1 时看行号：那是真的「点进去会到别处」的错误，必须改。
- 大小写差异（`agent2api` vs `Agent2API`）目前算不一致——GitHub 会 301，但链接文字与仓库现状不符，建议顺手改对。
- 「代表」行里可能写裸名字（如 `minio/minio · prisma/orm`），那些不是链接位，不参与检查。
