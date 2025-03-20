---
layout: layouts/event.njk
date: 2023-05-14T11:05:08.970Z
---

我发现浏览器有一个很离谱的 BUG，我不知道它是出于什么原因

```js
import { a } from "http:/127.0.0.1:8000/test.mjs";
console.log(a);
```

这个协议头不规范，居然能宽容地正确解析出来。
也就意味着在浏览器中，`new URL("https:/qaq.dweb/index.ts")` 能被合法解析成 `new URL("https://qaq.dweb/index.ts")`:

这个 bug，可以带来一个玩法。我可以利用这个 bug，用 node 实现类似 deno 的功能。因为 deno 近乎是完全使用浏览器的标准，所以说浏览器上面的这个 bug，在 deno 中同样也会有，也同样适用……
在 nodejs 项目里，只需要在 node_modules 里头创建一个 `https:` 的文件夹。它完全不会报错，可以正确解析。

比如说以下 deno 代码：

```ts
import { Server } from "https:/deno.land/std@0.187.0/http/server.ts"; // 这里使用单斜杆，也会被认为是双斜杠
```

然后同样的代码，在 nodejs 项目中，不启用 deno，只添加一个 tsconfig.json，使用 [ts5+](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#allowimportingtsextensions) 来实现 `.ts` 文件后缀的支持

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

最终效果如下图：

![](/img/http-protocol-with-one-dash/node-as-deno.png)
