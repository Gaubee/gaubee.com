---
layout: layouts/event.njk
date: 2023-04-07T00:50:33.815Z
---

这是社区的讨论：[Add onclose event to MessagePort #1766](https://github.com/whatwg/html/issues/1766#issuecomment-633197720)
当初我提到一个垫片方案，那时是 2020 年，所以当初只有 chrome69+的内核能支持：

```ts
/// worker
const lockReqId = "process-live-" + Date.now() + Math.random();
navigator.locks.request(lockReqId, () => new Promise(() => {}));
postMessage(lockReqId);

/// master
worker.addEventListener("message", (me) => {
  if (typeof me.data === "string" && me.data.startsWith("process-live-")) {
    navigator.locks.request(me.data, () => {
      worker.dispatchEvent(new CloseEvent("close"));
    });
  }
});
```

现在已经普遍支持

![caniuse-locks](/img/message-port-onclose/caniuse-locks.png)
