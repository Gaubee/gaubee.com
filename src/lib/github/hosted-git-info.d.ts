/**
 * hosted-git-info 的最小类型声明。
 *
 * 该包（v10）是纯 CJS 且无官方 .d.ts。此处只声明 GithubApp 用到的子集：
 * - fromUrl(url, opts?)：解析 git URL，返回 GitHost 实例或 null。
 * - GitHost.file(path, opts?)：把仓库相对路径转成 raw URL（GitHub 为 raw.githubusercontent.com）。
 * - GitHost.browse(path?, fragment?, opts?)：网页浏览 URL。
 * - GitHost 的 user/project/committish/type 属性。
 *
 * 运行时：`import GitHost from 'hosted-git-info'`（module.exports = GitHost 类）。
 * Vite CJS interop 下具名 import `{ fromUrl }` 不可用（fromUrl 是静态方法，非导出成员）。
 */
declare module "hosted-git-info" {
  export interface GitHostOptions {
    noCommittish?: boolean;
    noGitPlus?: boolean;
  }

  export interface GitHostFillArgs {
    committish?: string;
    path?: string;
    fragment?: string;
  }

  export class GitHost {
    type: string;
    user: string;
    auth?: string;
    project: string;
    committish?: string;
    default?: string;

    static fromUrl(url: string, opts?: GitHostOptions): GitHost | null;

    browse(opts?: GitHostOptions): string;
    browse(path: string, opts?: GitHostOptions): string;
    browse(path: string, fragment: string, opts?: GitHostOptions): string;
    browseFile(path: string, fragment: string, opts?: GitHostOptions): string;
    docs(opts?: GitHostOptions): string;
    https(opts?: GitHostOptions): string;
    shortcut(opts?: GitHostOptions): string;
    tarball(opts?: GitHostOptions): string;
    file(path: string, opts?: GitHostOptions): string;
    edit(path: string, opts?: GitHostOptions): string;
  }

  const GitHostExport: typeof GitHost;
  export default GitHostExport;
}

// 便捷类型别名：GitHost 类的实例类型（供消费方用作类型注解）
declare module "hosted-git-info" {
  export type GitHostInstance = InstanceType<GitHost>;
}
