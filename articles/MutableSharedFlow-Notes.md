---
layout: layouts/article.njk
title: "MutableSharedFlow 随记"
date: 2024-04-05T11:08:28.829Z
updated: 2024-04-05T11:08:28.829Z
tags:
  - Kotlin
---

MutableSharedFlow 作为一个建立在 Flow 基础上的设计，它的 Shared 特性其实与 Flow 的 collect 有着设计上的冲突。
因为 Shared 特性，它的 emit 与它的订阅者有关系，订阅者的消费速度决定着它的发射速度。然而如果没有消费者，就意味着它的 emit 会直接丢失，而没有被消费到。
举个例子：

```kotlin
val sharedFlow = MutableSharedFlow<Int>();
launch {
    sharedFlow.collect {
        println(it) // 这里通常不会有任何打印
    }
}
sharedFlow.emit(1)
```

因为 launch 的执行需要时间，在这段时间里，emit 可能已经执行完毕了，从而导致发射的值没有被任何人消费从而丢失。
这对于将 MutableSharedFlow 直接作为 EventEmitter 的替代者来说，会是一个很严重的设计缺陷。

---

因此，如果要使用 MutableSharedFlow 实现 EventEmitter，需要将 MutableSharedFlow 作为一个间接方案来使用。

---

最简单的方案就是将 MutableSharedFlow 的 extraBufferCapacity 参数拉得非常高，等于开一个缓冲区来缓冲，这也许能解决 99%的问题。
但这种解决方式非常奇怪，就是明知道有问题，但是用暴力的方式来规避问题发生的概率。
这个方案唯一的好处就是代码量相对比较少。

---

还有一种方案是使用 Channel：

```kotlin
val channel = Channel<Int>();
val sharedFlow = channel.consumeAsFlow().shareIn(currentCoroutineContext(), SharingStarted.Lazily)
launch {
    sharedFlow.collect {
        println(it) // 这里通常不会有任何打印
    }
}
channel.send(1)
```

这个方案其实是创建了一个 Channel，两个 Flow。
其中一个 Flow 就是用来接收 Channel 发射出来的所有值并缓存起来（注意这个 flow 不会阻塞 channel）。
第二个 Flow 是通过 shareIn 创建出来的，它是 SharingStarted.Lazily，也就意味着只有在 sharedFlow.collect 执行的时候，上游的 flow 才会把值发射出来（注意，这里的发送是一次性全部发射出来）。

这个方案只能说勉勉强强达到我们的需求，但问题也很多：

1. 它的 channel.send 并没有阻塞，而是全部被一个 flow 瞬间消费了。
1. flow 在将数据发射给 sharedFlow 的时候也不被 sharedFlow 的订阅者阻塞，也就是说如果你同时进行两次 `launch sharedFlow.collect` ，即便第一个 sharedFlow 是在慢慢地消费，但后面那 sharedFlow 因为晚起，所以会丢失所有的数据。
   > 这个我也不理解它怎么会这样，大家可以自己做实验，这里贴出实验代码:
   >
   > ```kotlin
   > val channel = Channel<Int>()
   > val MAX = 5;
   > launch {
   >   /// 所有的send，并不会被 collect 阻塞，consumeAsFlow/receiveAsFlow 已经将它全部消费
   >   delay(1000)
   >   println("start send")
   >   for (i in 1..MAX) {
   >     channel.send(i)
   >     println("send($i)")
   >   }
   > }
   > val flow = channel.receiveAsFlow().shareIn(this, SharingStarted.Lazily)
   > launch {
   >   flow.collect {
   >     println("collect1($it)")
   >     delay(1000)
   >   }
   > }
   > launch {
   >   delay(2000)
   >   flow.collect {
   >     println("collect2($it)")
   >   }
   > }
   > ```
1. 这里用 consumeAsFlow 还是 receiveAsFlow 都一样

---

但其实我们的希望是，MutableSharedFlow 能够顺序地进行 collect 与 emit。但是 collect 本身是一个阻塞函数，所以尝试从 emit 上入手：
试着在没有订阅者的时候，需要阻塞 emit 函数，直到有订阅者的时候才进入。
其实标准做法是这样的：

```kotlin
val sharedFlow = MutableSharedFlow<Int>().onSubscription {
    sharedFlow.emit(1)
}
launch {
    sharedFlow.collect {
        println(it) // 这里通常不会有任何打印
    }
}
```

但这其实就不是 EventEmitter 了，比方说我用它来实现一个 onStart，难不成要等到有人来订阅了才去触发 onStart？！并不是的，onStart 它本身是跟着上下文的需求该触发时就要触发。因此官方提供的 onSubscription 这个方案并不成立。

---
