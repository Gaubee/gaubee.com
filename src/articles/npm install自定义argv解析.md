---
layout: layouts/article.njk
title: "npm install自定义argv解析"
date: 2016-02-28T08:50:18Z
updated: 2016-02-28T09:51:12Z
---

## 问题描述与解决的方向

问题来着一下这种需求出现的时候：

一个包，要面对不同的用户：Client 与 Server。

由于这个包中 Client 与 Server 共用部分代码，如果要拆分成 Client 包与 Server 包的话，那么就还要有一个公共 Common 包。

所以要实现以下效果：

默认为安装 Client 的包

```
npm install my_npm_pkg
```

增加`--server`参数为安装 Server 的包

```
npm instal my_npm_pkg --server
```

## 参考文档

在[ENVIRONMENT](https://docs.npmjs.com/misc/scripts#environment)环节中有讲到 package.json 文件在 npm 命令运行的时候，相关的配置以及参数会被拍扁，变成环境变量。

![image](/_img/npm-install-with-argv/package-json-vars.png)

其中就包括这个字段：`npm_config_argv`
这个是一个 JSON 数据，里面包含了`npm`指令执行时的参数：

```js
const npm_argv = JSON.parse(process.env.npm_config_argv);
npm_argv instanceof Array; //true  ["npm", "instal", "my_npm_pkg", "--server"]
```

## DEMO 代码：

![image](/_img/npm-install-with-argv/demo-capture-1.png)

![image](/_img/npm-install-with-argv/demo-capture-2.png)

![image](/_img/npm-install-with-argv/demo-capture-3.png)

## 解决问题代码：

```js
const exec = require("child_process").exec;
const npm_argv = JSON.parse(process.env.npm_config_argv || "{}");
if (!(npm_argv && npm_argv.original instanceof Array)) {
  throw TypeError("npm argv Error"); // 异常的抛出会终止npm install命令
}
if (npm_argv.original.indexOf("--server") !== -1) {
  console.log("install dependencies: mongodb.");
  const child = exec(`cd ${__dirname} && npm install mongodb`); // 安装依赖
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
}
```
