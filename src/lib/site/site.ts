/**
 * 站点级展示常量（单一事实源，SPA 底部状态栏与 SSG 页脚共用）。
 *
 * ICP 备案规范（工信部《非经营性互联网信息服务备案管理办法》）：
 * - 网站底部标注 ICP 备案号，且备案号必须链接到工信部备案管理系统；
 * - 链接新窗口打开，rel 带 noopener noreferrer。
 */

/** 站点展示信息 */
export const SITE = {
  /** GitHub 源码仓库 */
  githubUrl: "https://github.com/Gaubee/gaubee.com",
  /** ICP 备案展示 */
  beian: {
    /** 备案号（含主体分号后缀） */
    label: "闽ICP备17026139号-1",
    /** 工信部备案管理系统（备案号规范跳转目标，不可改动） */
    url: "https://beian.miit.gov.cn/",
  },
} as const;
