---
layout: layouts/article.njk
title: "在JS中实现+=/-=操作符的重载"
date: 2017-10-29T02:36:22Z
updated: 2017-11-09T03:25:43Z
---

## 运用场景
这是一个语法糖，只是为了简化一些API的写法，比如：
```js
this.list += item // array push
this.list -= item // array remove
```
```js
this.on('click').events += cb; // add event
this.on('click').events -= cb; // remove event
```
## 如何实现

JS原生支持`=`操作符号的重载，即getter/setter：
```js
const a = {
  get z(){ return 666; }
}
```
而+=操作符号，是针对于string、number这两种类型来做拼接与累加操作的。
如果只是单纯实现+=，我建议使用string来做实现，因为js对于number类型的操作有一些精度问题，所以还是要小心规避，我没去关注不同浏览器在精度方面的差异。
但因为要操作-=，这就无法规避number类型了。所以我统一使用number来实现。

因为+=/-=后面接受的都是一个数字或者能转换成数字的对象，才能避免出现NaN。
下面我以实现一个PromisePool来作为实现的例子：
```js
class PromisePool extends Array {
	constructor(...args) {
		super(...args);
		// 使用小数来作为ID标识
		Object.defineProperty(this, "_base", {
			value: 0.4572015816549748
		});
		// -= 的时候使用
		Object.defineProperty(this, "_base_res", {
			value: 1 - this._base
		});
	}
	get pool() {
		return this._base;
	}
	set pool(v) {
		var cv = "0." + v.toString().split(".")[1];
		// 从缓存取获取对象
		const obj = global.__op_temp__;
		// console.log(obj)
		if (cv == this._base) {
			// 使用了+=运算符
			this.push(obj);
		} else if (cv == this._base_res) {
			// 使用了-=运算符
			var index = this.indexOf(obj);
			if (index >= 0) {
				this.splice(index, 1);
			}
		} else {
			// 忽略，或者抛出异常
			console.error(cv, this._base);
		}
	}
}
pp = new PromisePool();
global.__op_temp__ = { name: "test" };
pp.pool += 1;
console.log(pp.length, pp[0]);
console.log("-------------");
pp.pool -= 1;
console.log(pp.length, pp[0]);
```
这段DEMO的**重点**是：
1. 使用一个固有小数作为ID标识
2. += -= 只接受自然数，避免和ID冲突
3. 使用一个全局变量`__op_temp__`来存储要传入的对象
输出结果为：
```
1 { name: 'test' }
-------------
0 undefined
```

接下来要解决的就是如何把一个非Number对象传入PromisePool里头了，以及如果规避使用`__op_temp__`带来的内存隐患。
其实现的核心方法是：在执行+=或者-=算术运算的时候，js引擎会去调用一个对象的valueOf方法，所以我们要重载这个方法。
```js
Object.defineProperty(Promise, "__OP_VAL__", { value: 0 });
Promise.prototype.valueOf = function() {
	global.__op_temp__ = this;
	return Promise.__OP_VAL__;
};

var pitem = Promise.resolve(666);
pp.pool += pitem;
console.log(pp.length, pp[0]);
console.log("-------------");
pp.pool -= pitem;
console.log(pp.length, pp[0]);
```
以上代码中，我重写了Promise原型链中的valueOf方法，我使用`0`值来作为返回值，这个返回值不能乱来，我建议就是直接用0，否则会直接引发精度问题。

这些代码基本就已经实现了我们要的效果了。接下来就是补充内存管理的问题了，就是`__op_temp__`这个对象一直缓存着最后一个Promise对象，怎么给它释放掉？
很简单，在我们运行`pp.pool+=pitem`的时候，这时候的js引擎执行的就是`valueOf( set op_temp ) => setter( get op_temp )`。也就是说`__op_temp__`在赋值后，只执行了一次“取值”就没用了。我们可以在这个取值之后直接释放掉引用。
```js
// __op_temp_null_: 说明缓存取中没有东西
Object.defineProperty(global, "__op_temp_null_", {
	value: Symbol("Operators Object NULL")
});
const op_temp_key = Symbol("Operators Object TEMP");
Object.defineProperty(global, "__op_temp__", {
	get() {
		const res = this[op_temp_key];
		// 取值后马上移除引用关系
		this[op_temp_key] = global.__op_temp_null_;
		return res;
	},
	set(v) {
		this[op_temp_key] = v;
	}
});
```
如此内存方面的隐患就解决了。

--------

以上源码位于：https://gist.github.com/Gaubee/91b34fc56f3890bdbad681d4a8f47424