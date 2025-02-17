---
layout: layouts/article.njk
title: "JS语法解读"
date: 2014-09-07T17:39:41Z
updated: 2014-09-07T17:53:46Z
tags:
  - javascript
---

以下内容都是由[EsprimaJS](http://esprima.org/)中提取而出，确保完整性和准确性
### 声明
- **BlockStatement** 代码块，存在于function，if-else，while，try等可以包裹代码块的地方
- **BreakStatement** break当前循环或者break指定label的循环
- **ContinueStatement** continue当前循环或者continue指定label的循环
- **DoWhileStatement** do-while循环声明
- **DebuggerStatement** debugger关键字声明，用过JS调试的都知道
- **EmptyStatement** 如果`;`前面没有任何代码，就是空的
- **ExpressionStatement** 表达式语句，其它声明以外都会用到这个来对表达式进行包裹
- **ForStatement** for循环声明
- **ForInStatement** for-in循环声明
- **IfStatement** if声明，内部已经包含了consequent与alternate两部分的代码内容
- **LabeledStatement** 标记声明，用于循环体前针对声明，使得break、continue等关键字能在嵌套循环体中明确控制标记声明的循环体
- **ReturnStatement** 函数体返回值声明
- **SwitchStatement** switch条件分支语句声明
- **ThrowStatement** throw异常抛出声明
- **TryStatement** try错误捕获声明
- **WhileStatement** while声明
- **WithStatement** with声明
### 定义
- **FunctionDeclaration** function函数定义
- **VariableDeclaration** var变量定义
### 表达式
- **AssignmentExpression** 赋值表达式，`=`
- **ArrayExpression** 数组表达式
- **BinaryExpression** 二进制表达式，或者是运算表达式，比如`>>`、`<<`、`+`、`^`等等
- **CallExpression** 调用表达式，运行函数时会出现
- **ConditionalExpression** 条件表达式
- **FunctionExpression** 函数表达式，在表达式里头声明函数
- **LogicalExpression** 逻辑表达式，就`||`、`&&`什么的
- **MemberExpression** 成员表达式，取对象时的表达式，比如`console.log`，值得注意的是，因为JS可以通过key去对象，所以MemberExpression里头有一个computed属性来标识是要通过通过key映射取值还是直接取值。如果computed为true，则想要取一下key的值，然后再用这个值取取属性。
- **NewExpression** 实例化对象表达式
- **ObjectExpression** 对象表达式，例如`a = {}`
- **SequenceExpression** 序列表达式，意味着多个表达式混合，用`,`进行分隔
- **ThisExpression** this对象
- **UnaryExpression** 一元表达式，比如`-1`，虽然`--`、`++`也是单目，但是这里归入下面的`UpdateExpression`
- **UpdateExpression** 更新表达式，包括`++`、`--`、`+=`、`/=`等等
### 其它
- **CatchClause** 必须和TryStatement配套，存在于TryStatement的handlers属性中。有趣的是，源代码的写法注定了catch最多只能有一个，毕竟JS弱类型不像JAVA那样按类型匹配Error可以有多个类型。而handlers属性作为Array，是否意味着将来JS的catch的写法可以被进一步丰富来实现多catch？甚至更多……
- **Identifier** 标识符，到处可见，变量名、属性名等等
- **Literal** 特定文字，包括数值、字符串、null、true等常量
- **Program** 程序，AST树最外层的包裹
- **Property** 必须和ObjectExpression配套，作为ObjectExpression的properties属性声明队列中的子元素
- **SwitchCase** 必须和SwitchStatement配套
- **VariableDeclarator** 必须和VariableDeclaration配套，因为var是可以同时声明多个变量的，而VariableDeclarator则是作为里头一个个的变量声明
