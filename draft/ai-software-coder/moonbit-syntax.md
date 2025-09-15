# Introduction

A MoonBit program consists of top-level definitions including:

- type definitions
- function definitions
- constant definitions and variable bindings
- `init` functions, `main` function and/or `test` blocks.

## Expressions and Statements

MoonBit distinguishes between statements and expressions. In a function body, only the last clause should be an expression, which serves as a return value. For example:

```moonbit
fn foo() -> Int {
  let x = 1
  x + 1
}

fn bar() -> Int {
  let x = 1
  //! x + 1
  x + 2
}
```

Expressions include:

- Value literals (e.g. Boolean values, numbers, characters, strings, arrays, tuples, structs)
- Arithmetical, logical, or comparison operations
- Accesses to array elements (e.g. `a[0]`), struct fields (e.g `r.x`), tuple components (e.g. `t.0`), etc.
- Variables and (capitalized) enum constructors
- Anonymous local function definitions
- `match`, `if`, `loop` expressions, etc.

Statements include:

- Named local function definitions
- Local variable bindings
- Assignments
- `return` statements
- Any expression whose return type is `Unit`, (e.g. `ignore`)

A code block can contain multiple statements and one expression, and the value of the expression is the value of the code block.

## Variable Binding

A variable can be declared as mutable or immutable using `let mut` or `let`, respectively. A mutable variable can be reassigned to a new value, while an immutable one cannot.

A constant can only be declared at top level and cannot be changed.

```moonbit
let zero = 0

const ZERO = 0

fn main {
  //! const ZERO = 0 
  let mut i = 10
  i = 20
  println(i + zero + ZERO)
}
```

#### NOTE
A top level variable binding

- requires **explicit** type annotation (unless defined using literals such as string, byte or numbers)
- can’t be mutable (use `Ref` instead)

## Naming conventions

Variables, functions should start with lowercase letters `a-z` and can contain letters, numbers, underscore, and other non-ascii unicode chars.
It is recommended to name them with snake_case.

Constants, types should start with uppercase letters `A-Z` and can contain letters, numbers, underscore, and other non-ascii unicode chars.
It is recommended to name them with PascalCase or SCREAMING_SNAKE_CASE.

## Program entrance

### `init` and `main`

There is a specialized function called `init` function. The `init` function is special:

1. It has no parameter list nor return type.
2. There can be multiple `init` functions in the same package.
3. An `init` function can’t be explicitly called or referred to by other functions.
   Instead, all `init` functions will be implicitly called when initializing a package. Therefore, `init` functions should only consist of statements.

```moonbit
fn init {
  let x = 1
  println(x)
}
```

There is another specialized function called `main` function. The `main` function is the main entrance of the program, and it will be executed after the initialization stage.

Same as the `init` function, it has no parameter list nor return type.

```moonbit
fn main {
  let x = 2
  println(x)
}
```

The previous two code snippets will print the following at runtime:

```bash
1
2
```

Only packages that are `main` packages can define such `main` function. Check out [build system tutorial](../toolchain/moon/tutorial.md) for detail.

```json
{
  "is-main": true
}
```

### `test`

There’s also a top-level structure called `test` block. A `test` block defines inline tests, such as:

```moonbit
test "test_name" {
  assert_eq!(1 + 1, 2)
  assert_eq!(2 + 2, 4)
  inspect!([1, 2, 3], content="[1, 2, 3]")
}
```

The following contents will use `test` block and `main` function to demonstrate the execution result,
and we assume that all the `test` blocks pass unless stated otherwise.


# Fundamentals

## Built-in Data Structures

### Boolean

MoonBit has a built-in boolean type, which has two values: `true` and `false`. The boolean type is used in conditional expressions and control structures.

```moonbit
let a = true
let b = false
let c = a && b
let d = a || b
let e = not(a)
```

### Number

MoonBit have integer type and floating point type:

| type     | description                                       | example                    |
|----------|---------------------------------------------------|----------------------------|
| `Int`    | 32-bit signed integer                             | `42`                       |
| `Int64`  | 64-bit signed integer                             | `1000L`                    |
| `UInt`   | 32-bit unsigned integer                           | `14U`                      |
| `UInt64` | 64-bit unsigned integer                           | `14UL`                     |
| `Double` | 64-bit floating point, defined by IEEE754         | `3.14`                     |
| `Float`  | 32-bit floating point                             | `(3.14 : Float)`           |
| `BigInt` | represents numeric values larger than other types | `10000000000000000000000N` |

MoonBit also supports numeric literals, including decimal, binary, octal, and hexadecimal numbers.

To improve readability, you may place underscores in the middle of numeric literals such as `1_000_000`. Note that underscores can be placed anywhere within a number, not just every three digits.

- Decimal numbers can have underscore between the numbers.

  By default, an int literal is signed 32-bit number. For unsigned numbers, a postfix `U` is needed; for 64-bit numbers, a postfix `L` is needed.
  ```moonbit
  let a = 1234
  let b : Int = 1_000_000 + a
  let unsigned_num       : UInt   = 4_294_967_295U
  let large_num          : Int64  = 9_223_372_036_854_775_807L
  let unsigned_large_num : UInt64 = 18_446_744_073_709_551_615UL
  ```
- A binary number has a leading zero followed by a letter “B”, i.e. `0b`/`0B`.
  Note that the digits after `0b`/`0B` must be `0` or `1`.
  ```moonbit
  let bin = 0b110010
  let another_bin = 0B110010
  ```
- An octal number has a leading zero followed by a letter “O”, i.e. `0o`/`0O`.
  Note that the digits after `0o`/`0O` must be in the range from `0` through `7`:
  ```moonbit
  let octal = 0o1234
  let another_octal = 0O1234
  ```
- A hexadecimal number has a leading zero followed by a letter “X”, i.e. `0x`/`0X`.
  Note that the digits after the `0x`/`0X` must be in the range `0123456789ABCDEF`.
  ```moonbit
  let hex = 0XA
  let another_hex = 0xA_B_C
  ```
- A floating-point number literal is 64-bit floating-point number. To define a float, type annotation is needed.
  ```moonbit
  let double = 3.14 // Double
  let float : Float = 3.14
  let float2 = (3.14 : Float)
  ```

  A 64-bit floating-point number can also be defined using hexadecimal format:
  ```moonbit
  let hex_double = 0x1.2P3 // (1.0 + 2 / 16) * 2^(+3) == 9
  ```

#### Overloaded literal

When the expected type is known, MoonBit can automatically overload literal, and there is no need to specify the type of number via letter postfix:

```moonbit
let int : Int = 42
let uint : UInt = 42
let int64 : Int64 = 42
let double : Double = 42
let float : Float = 42
let bigint : BigInt = 42
```

### String

`String` holds a sequence of UTF-16 code units. You can use double quotes to create a string, or use `#|` to write a multi-line string.

```moonbit
let a = "兔rabbit"
println(a[0])
println(a[1])
let b =
  #| Hello
  #| MoonBit\n
  #|
println(b)
```

```default
'兔'
'r'
 Hello
 MoonBit\n

```

In double quotes string, a backslash followed by certain special characters forms an escape sequence:

| escape sequences     | description                                          |
|----------------------|------------------------------------------------------|
| `\n`,`\r`,`\t`,`\b`  | New line, Carriage return, Horizontal tab, Backspace |
| `\\`                 | Backslash                                            |
| `\x41`               | Hexadecimal escape sequence                          |
| `\o102`              | Octal escape sequence                                |
| `\u5154`,`\u{1F600}` | Unicode escape sequence                              |

MoonBit supports string interpolation. It enables you to substitute variables within interpolated strings. This feature simplifies the process of constructing dynamic strings by directly embedding variable values into the text. Variables used for string interpolation must support the `to_string` method.

```moonbit
let x = 42
println("The answer is \{x}")
```

Multi-line strings do not support interpolation by default, but you can enable interpolation for a specific line by changing the leading `#|` to `$|`:

```moonbit
let lang = "MoonBit"
let str =
  #| Hello
  #| ---
  $| \{lang}\n
  #| ---
println(str)
```

```default
 Hello
 ---
 MoonBit

 ---
```

### Char

`Char` represents a Unicode code point.

```moonbit
let a : Char = 'A'
let b = '\x41'
let c = '兔'
let zero = '\u{30}'
let zero = '\u0030'
```

### Byte(s)

A byte literal in MoonBit is either a single ASCII character or a single escape enclosed in single quotes `'`, and preceded by the character `b`. Byte literals are of type `Byte`. For example:

```moonbit
fn main {
  let b1 : Byte = b'a'
  println(b1.to_int())
  let b2 = b'\xff'
  println(b2.to_int())
}
```

```default
97
255
```

A `Bytes` is a sequence of bytes. Similar to byte, bytes literals have the form of `b"..."`. For example:

```moonbit
test {
  let b1 : Bytes = b"abcd"
  let b2 = b"\x61\x62\x63\x64"
  assert_eq!(b1, b2)
}
```

### Tuple

A tuple is a collection of finite values constructed using round brackets `()` with the elements separated by commas `,`. The order of elements matters; for example, `(1,true)` and `(true,1)` have different types. Here’s an example:

```moonbit
fn main {
  fn pack(
    a : Bool,
    b : Int,
    c : String,
    d : Double
  ) -> (Bool, Int, String, Double) {
    (a, b, c, d)
  }

  let quad = pack(false, 100, "text", 3.14)
  let (bool_val, int_val, str, float_val) = quad
  println("\{bool_val} \{int_val} \{str} \{float_val}")
}
```

```default
false 100 text 3.14
```

Tuples can be accessed via pattern matching or index:

```moonbit
test {
  let t = (1, 2)
  let (x1, y1) = t
  let x2 = t.0
  let y2 = t.1
  assert_eq!(x1, x2)
  assert_eq!(y1, y2)
}
```

### Ref

A `Ref[T]` is a mutable reference containing a value `val` of type `T`.

It can be constructed using `{ val : x }`, and can be accessed using `ref.val`. See [struct]() for detailed explanation.

```moonbit
let a : Ref[Int] = { val : 100 }

test {
  a.val = 200
  assert_eq!(a.val, 200)
  a.val += 1
  assert_eq!(a.val, 201)
}
```

### Option and Result

`Option` and `Result` are the most common types to represent a possible error or failure in MoonBit.

- `Option[T]` represents a possibly missing value of type `T`. It can be abbreviated as `T?`.
- `Result[T, E]` represents either a value of type `T` or an error of type `E`.

See [enum]() for detailed explanation.

```moonbit
test {
  let a : Option[Int] = None
  let b : Option[Int] = Some(42)
  let c : Result[Int, String] = Ok(42)
  let d : Result[Int, String] = Err("error")
  match a {
    Some(_) => assert_true!(false)
    None => assert_true!(true)
  }
  match d {
    Ok(_) => assert_true!(false)
    Err(_) => assert_true!(true)
  }
}
```

### Array

An array is a finite sequence of values constructed using square brackets `[]`, with elements separated by commas `,`. For example:

```moonbit
let numbers = [1, 2, 3, 4]
```

You can use `numbers[x]` to refer to the xth element. The index starts from zero.

```moonbit
test {
  let numbers = [1, 2, 3, 4]
  let a = numbers[2]
  numbers[3] = 5
  let b = a + numbers[3]
  assert_eq!(b, 8)
}
```

There are `Array[T]` and `FixedArray[T]`:

- `Array[T]` can grow in size, while
- `FixedArray[T]` has a fixed size, thus it needs to be created with initial value.

#### WARNING
A common pitfall is creating `FixedArray` with the same initial value:

```moonbit
test {
  let two_dimension_array = FixedArray::make(10, FixedArray::make(10, 0))
  two_dimension_array[0][5] = 10
  assert_eq!(two_dimension_array[5][5], 10)
}
```

This is because all the cells reference to the same object (the `FixedArray[Int]` in this case). One should use `FixedArray::makei()` instead which creates an object for each index.

```moonbit
test {
  let two_dimension_array = FixedArray::makei(
    10, 
    fn (_i) { FixedArray::make(10, 0) }
  )
  two_dimension_array[0][5] = 10
  assert_eq!(two_dimension_array[5][5], 0)
}
```

When the expected type is known, MoonBit can automatically overload array, otherwise
`Array[T]` is created:

```moonbit
let fixed_array_1 : FixedArray[Int] = [1, 2, 3]
let fixed_array_2 = ([1, 2, 3] : FixedArray[Int])
let array_3 = [1, 2, 3] // Array[Int]
```

#### ArrayView

Analogous to `slice` in other languages, the view is a reference to a
specific segment of collections. You can use `data[start:end]` to create a
view of array `data`, referencing elements from `start` to `end` (exclusive).
Both `start` and `end` indices can be omitted.

```moonbit
test {
  let xs = [0, 1, 2, 3, 4, 5]
  let s1 : ArrayView[Int] = xs[2:]
  inspect!(s1, content="[2, 3, 4, 5]")
  inspect!(xs[:4], content="[0, 1, 2, 3]")
  inspect!(xs[2:5], content="[2, 3, 4]")
  inspect!(xs[:], content="[0, 1, 2, 3, 4, 5]")
}
```

### Map

MoonBit provides a hash map data structure that preserves insertion order called `Map` in its standard library.
`Map`s can be created via a convenient literal syntax:

```moonbit
let map : Map[String, Int] = { "x": 1, "y": 2, "z": 3 }
```

Currently keys in map literal syntax must be constant. `Map`s can also be destructed elegantly with pattern matching, see [Map Pattern]().

### Json literal

MoonBit supports convenient json handling by overloading literals.
When the expected type of an expression is `Json`, number, string, array and map literals can be directly used to create json data:

```moonbit
let moon_pkg_json_example : Json = {
  "import": ["moonbitlang/core/builtin", "moonbitlang/core/coverage"],
  "test-import": ["moonbitlang/core/random"],
}
```

Json values can be pattern matched too, see [Json Pattern]().

## Functions

Functions take arguments and produce a result. In MoonBit, functions are first-class, which means that functions can be arguments or return values of other functions. MoonBit’s naming convention requires that function names should not begin with uppercase letters (A-Z). Compare for constructors in the `enum` section below.

### Top-Level Functions

Functions can be defined as top-level or local. We can use the `fn` keyword to define a top-level function that sums three integers and returns the result, as follows:

```moonbit
fn add3(x : Int, y : Int, z : Int) -> Int {
  x + y + z
}
```

Note that the arguments and return value of top-level functions require **explicit** type annotations.

### Local Functions

Local functions can be named or anonymous. Type annotations can be omitted for local function definitions: they can be automatically inferred in most cases. For example:

```moonbit
fn local_1() -> Int {
  fn inc(x) { // named as `inc`
    x + 1
  }
  // anonymous, instantly applied to integer literal 6
  (fn(x) { x + inc(2) })(6)
}

test {
  assert_eq!(local_1(), 9)
}
```

There’s also a form called **matrix function** that make use of [pattern matching]():

```moonbit
let extract : (Int?, Int) -> Int = fn {
  Some(x), _ => x
  None, default => default
}
```

Functions, whether named or anonymous, are *lexical closures*: any identifiers without a local binding must refer to bindings from a surrounding lexical scope. For example:

```moonbit
let global_y = 3

fn local_2(x : Int) -> (Int, Int) {
  fn inc() {
    x + 1
  }

  fn four() {
    global_y + 1
  }

  (inc(), four())
}

test {
  assert_eq!(local_2(3), (4, 4))
}
```

### Function Applications

A function can be applied to a list of arguments in parentheses:

```moonbit
add3(1, 2, 7)
```

This works whether `add3` is a function defined with a name (as in the previous example), or a variable bound to a function value, as shown below:

```moonbit
test {
  let add3 = fn(x, y, z) { x + y + z }
  assert_eq!(add3(1, 2, 7), 10)
}
```

The expression `add3(1, 2, 7)` returns `10`. Any expression that evaluates to a function value is applicable:

```moonbit
test {
  let f = fn(x) { x + 1 }
  let g = fn(x) { x + 2 }
  let w = (if true { f } else { g })(3)
  assert_eq!(w, 4)
}
```

### Labelled arguments

**Top-level** functions can declare labelled argument with the syntax `label~ : Type`. `label` will also serve as parameter name inside function body:

```moonbit
fn labelled_1(arg1~ : Int, arg2~ : Int) -> Int {
  arg1 + arg2
}
```

Labelled arguments can be supplied via the syntax `label=arg`. `label=label` can be abbreviated as `label~`:

```moonbit
test {
  let arg1 = 1
  assert_eq!(labelled_1(arg2=2, arg1~), 3)
}
```

Labelled function can be supplied in any order. The evaluation order of arguments is the same as the order of parameters in function declaration.

### Optional arguments

A labelled argument can be made optional by supplying a default expression with the syntax `label~ : Type = default_expr`. If this argument is not supplied at call site, the default expression will be used:

```moonbit
fn optional(opt~ : Int = 42) -> Int {
  opt
}

test {
  assert_eq!(optional(), 42)
  assert_eq!(optional(opt=0), 0)
}
```

The default expression will be evaluated every time it is used. And the side effect in the default expression, if any, will also be triggered. For example:

```moonbit
fn incr(counter~ : Ref[Int] = { val: 0 }) -> Ref[Int] {
  counter.val = counter.val + 1
  counter
}

test {
  inspect!(incr(), content="{val: 1}")
  inspect!(incr(), content="{val: 1}")
  let counter : Ref[Int] = { val: 0 }
  inspect!(incr(counter~), content="{val: 1}")
  inspect!(incr(counter~), content="{val: 2}")
}
```

If you want to share the result of default expression between different function calls, you can lift the default expression to a toplevel `let` declaration:

```moonbit
let default_counter : Ref[Int] = { val: 0 }

fn incr_2(counter~ : Ref[Int] = default_counter) -> Int {
  counter.val = counter.val + 1
  counter.val
}

test {
  assert_eq!(incr_2(), 1)
  assert_eq!(incr_2(), 2)
}
```

Default expression can depend on the value of previous arguments. For example:

```moonbit
fn sub_array[X](
  xs : Array[X],
  offset~ : Int,
  len~ : Int = xs.length() - offset
) -> Array[X] {
  xs[offset:offset + len].iter().to_array()
}

test {
  assert_eq!(sub_array([1, 2, 3], offset=1), [2, 3])
  assert_eq!(sub_array([1, 2, 3], offset=1, len=1), [2])
}
```

#### Automatically insert `Some` when supplying optional arguments

It is quite often optional arguments have type `T?` with `None` as default value.
In this case, passing the argument explicitly requires wrapping a `Some`,
which is ugly:

```moonbit
fn ugly_constructor(width~ : Int? = None, height~ : Int? = None) -> Image {
  ...
}

let img : Image = ugly_constructor(width=Some(1920), height=Some(1080))
```

Fortunately, MoonBit provides a special kind of optional arguments to solve this problem.
Optional arguments declared with `label? : T` has type `T?` and `None` as default value.
When supplying this kind of optional argument directly, MoonBit will automatically insert a `Some`:

```moonbit
fn nice_constructor(width? : Int, height? : Int) -> Image {
  ...
}

let img2 : Image = nice_constructor(width=1920, height=1080)
```

Sometimes, it is also useful to pass a value of type `T?` directly,
for example when forwarding optional argument.
MoonBit provides a syntax `label?=value` for this, with `label?` being an abbreviation of `label?=label`:

```moonbit
fn image(width? : Int, height? : Int) -> Image {
  ...
}

fn fixed_width_image(height? : Int) -> Image {
  image(width=1920, height?)
}
```

### Autofill arguments

MoonBit supports filling specific types of arguments automatically at different call site, such as the source location of a function call.
To declare an autofill argument, simply declare an optional argument with `_` as default value.
Now if the argument is not explicitly supplied, MoonBit will automatically fill it at the call site.

Currently MoonBit supports two types of autofill arguments, `SourceLoc`, which is the source location of the whole function call,
and `ArgsLoc`, which is a array containing the source location of each argument, if any:

```moonbit
fn f(_x : Int, loc~ : SourceLoc = _, args_loc~ : ArgsLoc = _) -> String {
  $|loc of whole function call: \{loc}
  $|loc of arguments: \{args_loc}
  // loc of whole function call: <filename>:7:3-7:10
  // loc of arguments: [Some(<filename>:7:5-7:6), Some(<filename>:7:8-7:9), None, None]
}
```

Autofill arguments are very useful for writing debugging and testing utilities.

## Control Structures

### Conditional Expressions

A conditional expression consists of a condition, a consequent, and an optional `else` clause or `else if` clause.

```moonbit
if x == y {
  expr1
} else if x == z {
  expr2
} else {
  expr3
}
```

The curly brackets around the consequent are required.

Note that a conditional expression always returns a value in MoonBit, and the return values of the consequent and the else clause must be of the same type. Here is an example:

```moonbit
let initial = if size < 1 { 1 } else { size }
```

The `else` clause can only be omitted if the return value has type `Unit`.

### Match Expression

The `match` expression is similar to conditional expression, but it uses [pattern matching]() to decide which consequent to evaluate and extracting variables at the same time.

```moonbit
fn decide_sport(weather : String, humidity : Int) -> String {
  match weather {
    "sunny" => "tennis"
    "rainy" => if humidity > 80 { "swimming" } else { "football" }
    _ => "unknown"
  }
}

test {
  assert_eq!(decide_sport("sunny", 0), "tennis")
}
```

If a possible condition is omitted, the compiler will issue a warning, and the program will terminate if that case were reached.

### Guard Statement

The `guard` statement is used to check a specified invariant.
If the condition of the invariant is satisfied, the program continues executing
the subsequent statements and returns. If the condition is not satisfied (i.e., false),
the code in the `else` block is executed and its evaluation result is returned (the subsequent statements are skipped).

```moonbit
fn guarded_get(array : Array[Int], index : Int) -> Int? {
  guard index >= 0 && index < array.length() else { None }
  Some(array[index])
}

test {
  inspect!(guarded_get([1, 2, 3], -1), content="None")
}
```

#### Guarded Let

The `let` statement can be used with [pattern matching](). However, `let` statement can only handle one case. And `guard let` can solve this issue.

In the following example, `getProcessedText` assumes that the input `path` points to resources that are all plain text,
and it uses the `guard` statement to ensure this invariant. Compared to using
a `match` statement, the subsequent processing of `text` can have one less level of indentation.

```moonbit
enum Resource {
  Folder(Array[String])
  PlainText(String)
  JsonConfig(Json)
}

fn getProcessedText(
  resources : Map[String, Resource],
  path : String
) -> String!Error {
  guard let Some(PlainText(text)) = resources[path] else {
    None => fail!("\{path} not found")
    Some(Folder(_)) => fail!("\{path} is a folder")
    Some(JsonConfig(_)) => fail!("\{path} is a json config")
  }
  process(text)
}
```

When the `else` part is omitted, the program terminates if the condition specified
in the `guard` statement is not true or cannot be matched.

```moonbit
guard condition  // <=> guard condition else { panic() }
guard let Some(x) = expr
// <=> guard let Some(x) = expr else { _ => panic() }
```

### While loop

In MoonBit, `while` loop can be used to execute a block of code repeatedly as long as a condition is true. The condition is evaluated before executing the block of code. The `while` loop is defined using the `while` keyword, followed by a condition and the loop body. The loop body is a sequence of statements. The loop body is executed as long as the condition is true.

```moonbit
fn main {
  let mut i = 5
  while i > 0 {
    println(i)
    i = i - 1
  }
}
```

```default
5
4
3
2
1
```

The loop body supports `break` and `continue`. Using `break` allows you to exit the current loop, while using `continue` skips the remaining part of the current iteration and proceeds to the next iteration.

```moonbit
fn main {
  let mut i = 5
  while i > 0 {
    i = i - 1
    if i == 4 {
      continue
    }
    if i == 1 {
      break
    }
    println(i)
  }
}
```

```default
3
2
```

The `while` loop also supports an optional `else` clause. When the loop condition becomes false, the `else` clause will be executed, and then the loop will end.

```moonbit
fn main {
  let mut i = 2
  while i > 0 {
    println(i)
    i = i - 1
  } else {
    println(i)
  }
}
```

```default
2
1
0
```

When there is an `else` clause, the `while` loop can also return a value. The return value is the evaluation result of the `else` clause. In this case, if you use `break` to exit the loop, you need to provide a return value after `break`, which should be of the same type as the return value of the `else` clause.

```moonbit
fn main {
  let mut i = 10
  let r = while i > 0 {
    i = i - 1
    if i % 2 == 0 {
      break 5
    }
  } else {
    7
  }
  println(r)
}
```

```default
5
```

```moonbit
fn main {
  let mut i = 10
  let r = while i > 0 {
    i = i - 1
  } else {
    7
  }
  println(r)
}
```

```default
7
```

### For Loop

MoonBit also supports C-style For loops. The keyword `for` is followed by variable initialization clauses, loop conditions, and update clauses separated by semicolons. They do not need to be enclosed in parentheses.
For example, the code below creates a new variable binding `i`, which has a scope throughout the entire loop and is immutable. This makes it easier to write clear code and reason about it:

```moonbit
fn main {
  for i = 0; i < 5; i = i + 1 {
    println(i)
  }
}
```

```default
0
1
2
3
4
```

The variable initialization clause can create multiple bindings:

```moonbit
for i = 0, j = 0; i + j < 100; i = i + 1, j = j + 1 {
  println(i)
}
```

It should be noted that in the update clause, when there are multiple binding variables, the semantics are to update them simultaneously. In other words, in the example above, the update clause does not execute `i = i + 1`, `j = j + 1` sequentially, but rather increments `i` and `j` at the same time. Therefore, when reading the values of the binding variables in the update clause, you will always get the values updated in the previous iteration.

Variable initialization clauses, loop conditions, and update clauses are all optional. For example, the following two are infinite loops:

```moonbit
for i = 1; ; i = i + 1 {
  println(i)
}
for {
  println("loop forever")
}
```

The `for` loop also supports `continue`, `break`, and `else` clauses. Like the `while` loop, the `for` loop can also return a value using the `break` and `else` clauses.

The `continue` statement skips the remaining part of the current iteration of the `for` loop (including the update clause) and proceeds to the next iteration. The `continue` statement can also update the binding variables of the `for` loop, as long as it is followed by expressions that match the number of binding variables, separated by commas.

For example, the following program calculates the sum of even numbers from 1 to 6:

```moonbit
fn main {
  let sum = for i = 1, acc = 0; i <= 6; i = i + 1 {
    if i % 2 == 0 {
      println("even: \{i}")
      continue i + 1, acc + i
    }
  } else {
    acc
  }
  println(sum)
}
```

```default
even: 2
even: 4
even: 6
12
```

### `for .. in` loop

MoonBit supports traversing elements of different data structures and sequences via the `for .. in` loop syntax:

```moonbit
for x in [1, 2, 3] {
  println(x)
}
```

`for .. in` loop is translated to the use of `Iter` in MoonBit’s standard library. Any type with a method `.iter() : Iter[T]` can be traversed using `for .. in`.
For more information of the `Iter` type, see [Iterator]() below.

`for .. in` loop also supports iterating through a sequence of integers, such as:

```moonbit
test {
  let mut i = 0
  for j in 0..<10 {
    i += j
  }
  assert_eq!(i, 45)

  let mut k = 0
  for l in 0..=10 {
    k += l
  }
  assert_eq!(k, 55)
}
```

In addition to sequences of a single value, MoonBit also supports traversing sequences of two values, such as `Map`, via the `Iter2` type in MoonBit’s standard library.
Any type with method `.iter2() : Iter2[A, B]` can be traversed using `for .. in` with two loop variables:

```moonbit
for k, v in { "x": 1, "y": 2, "z": 3 } {
  println(k)
  println(v)
}
```

Another example of `for .. in` with two loop variables is traversing an array while keeping track of array index:

```moonbit
fn main {
  for index, elem in [4, 5, 6] {
    let i = index + 1
    println("The \{i}-th element of the array is \{elem}")
  }
}
```

```default
The 1-th element of the array is 4
The 2-th element of the array is 5
The 3-th element of the array is 6
```

Control flow operations such as `return`, `break` and error handling are supported in the body of `for .. in` loop:

```moonbit
fn main {
  let map = { "x": 1, "y": 2, "z": 3, "w": 4 }
  for k, v in map {
    if k == "y" {
      continue
    }
    println("\{k}, \{v}")
    if k == "z" {
      break
    }
  }
}
```

```default
x, 1
z, 3
```

If a loop variable is unused, it can be ignored with `_`.

### Functional loop

Functional loop is a powerful feature in MoonBit that enables you to write loops in a functional style.

A functional loop consumes arguments and returns a value. It is defined using the `loop` keyword, followed by its arguments and the loop body. The loop body is a sequence of clauses, each of which consists of a pattern and an expression. The clause whose pattern matches the input will be executed, and the loop will return the value of the expression. If no pattern matches, the loop will panic. Use the `continue` keyword with arguments to start the next iteration of the loop. Use the `break` keyword with arguments to return a value from the loop. The `break` keyword can be omitted if the value is the last expression in the loop body.

```moonbit
test {
  fn sum(xs : @immut/list.T[Int]) -> Int {
    loop xs, 0 {
      Nil, acc => break acc // <=> Nil, acc => acc
      Cons(x, rest), acc => continue rest, x + acc
    }
  }

  assert_eq!(sum(Cons(1, Cons(2, Cons(3, Nil)))), 6)
}
```

#### WARNING
Currently in `loop exprs { ... }`, `exprs` is nonempty list, while `for { ... }` is accepted for infinite loop.

## Iterator

An iterator is an object that traverse through a sequence while providing access
to its elements. Traditional OO languages like Java’s `Iterator<T>` use `next()`
`hasNext()` to step through the iteration process, whereas functional languages
(JavaScript’s `forEach`, Lisp’s `mapcar`) provides a high-order function which
takes an operation and a sequence then consumes the sequence with that operation
being applied to the sequence. The former is called *external iterator* (visible
to user) and the latter is called *internal iterator* (invisible to user).

The built-in type `Iter[T]` is MoonBit’s internal iterator implementation.
Almost all built-in sequential data structures have implemented `Iter`:

```moonbit
///|
fn filter_even(l : Array[Int]) -> Array[Int] {
  let l_iter : Iter[Int] = l.iter()
  l_iter.filter(fn { x => (x & 1) == 0 }).collect()
}

///|
fn fact(n : Int) -> Int {
  let start = 1
  let range : Iter[Int] = start.until(n)
  range.fold(Int::op_mul, init=start)
}
```

Commonly used methods include:

- `each`: Iterates over each element in the iterator, applying some function to each element.
- `fold`: Folds the elements of the iterator using the given function, starting with the given initial value.
- `collect`: Collects the elements of the iterator into an array.
- `filter`: *lazy* Filters the elements of the iterator based on a predicate function.
- `map`: *lazy* Transforms the elements of the iterator using a mapping function.
- `concat`: *lazy* Combines two iterators into one by appending the elements of the second iterator to the first.

Methods like `filter` `map` are very common on a sequence object e.g. Array.
But what makes `Iter` special is that any method that constructs a new `Iter` is
*lazy* (i.e. iteration doesn’t start on call because it’s wrapped inside a
function), as a result of no allocation for intermediate value. That’s what
makes `Iter` superior for traversing through sequence: no extra cost. MoonBit
encourages user to pass an `Iter` across functions instead of the sequence
object itself.

Pre-defined sequence structures like `Array` and its iterators should be
enough to use. But to take advantages of these methods when used with a custom
sequence with elements of type `S`, we will need to implement `Iter`, namely, a function that returns
an `Iter[S]`. Take `Bytes` as an example:

```moonbit
///|
fn iter(data : Bytes) -> Iter[Byte] {
  Iter::new(fn(visit : (Byte) -> IterResult) -> IterResult {
    for byte in data {
      guard let IterContinue = visit(byte) else { x => break x }

    } else {
      IterContinue
    }
  })
}
```

Almost all `Iter` implementations are identical to that of `Bytes`, the only
main difference being the code block that actually does the iteration.

### Implementation details

The type `Iter[T]` is basically a type alias for `((T) -> IterResult) -> IterResult`,
a higher-order function that takes an operation and `IterResult` is an enum
object that tracks the state of current iteration which consists any of the 2
states:

- `IterEnd`: marking the end of an iteration
- `IterContinue`: marking the end of an iteration is yet to be reached, implying the iteration will still continue at this state.

To put it simply, `Iter[T]` takes a function `(T) -> IterResult` and use it to
transform `Iter[T]` itself to a new state of type `IterResult`. Whether that
state being `IterEnd` `IterContinue` depends on the function.

Iterator provides a unified way to iterate through data structures, and they
can be constructed at basically no cost: as long as `fn(yield)` doesn’t
execute, the iteration process doesn’t start.

Internally a `Iter::run()` is used to trigger the iteration. Chaining all sorts
of `Iter` methods might be visually pleasing, but do notice the heavy work
underneath the abstraction.

Thus, unlike an external iterator, once the iteration starts
there’s no way to stop unless the end is reached. Methods such as `count()`
which counts the number of elements in a iterator looks like an `O(1)` operation
but actually has linear time complexity. Carefully use iterators or
performance issue might occur.

## Custom Data Types

There are two ways to create new data types: `struct` and `enum`.

### Struct

In MoonBit, structs are similar to tuples, but their fields are indexed by field names. A struct can be constructed using a struct literal, which is composed of a set of labeled values and delimited with curly brackets. The type of a struct literal can be automatically inferred if its fields exactly match the type definition. A field can be accessed using the dot syntax `s.f`. If a field is marked as mutable using the keyword `mut`, it can be assigned a new value.

```moonbit
struct User {
  id : Int
  name : String
  mut email : String
}
```

```moonbit
fn main {
  let u = User::{ id: 0, name: "John Doe", email: "john@doe.com" }
  u.email = "john@doe.name"
  //! u.id = 10
  println(u.id)
  println(u.name)
  println(u.email)
}
```

```default
0
John Doe
john@doe.name
```

#### Constructing Struct with Shorthand

If you already have some variable like `name` and `email`, it’s redundant to repeat those names when constructing a struct. You can use shorthand instead, it behaves exactly the same:

```moonbit
let name = "john"
let email = "john@doe.com"
let u = User::{ id: 0, name, email }
```

If there’s no other struct that has the same fields, it’s redundant to add the struct’s name when constructing it:

```moonbit
let u2 = { id : 0, name, email }
```

#### Struct Update Syntax

It’s useful to create a new struct based on an existing one, but with some fields updated.

```moonbit
fn main {
  let user = { id: 0, name: "John Doe", email: "john@doe.com" }
  let updated_user = { ..user, email: "john@doe.name" }
  println(
    $|{ id: \{user.id}, name: \{user.name}, email: \{user.email} }
    $|{ id: \{updated_user.id}, name: \{updated_user.name}, email: \{updated_user.email} }
    ,
  )
}
```

```default
{ id: 0, name: John Doe, email: john@doe.com }
{ id: 0, name: John Doe, email: john@doe.name }
```

### Enum

Enum types are similar to algebraic data types in functional languages. Users familiar with C/C++ may prefer calling it tagged union.

An enum can have a set of cases (constructors). Constructor names must start with capitalized letter. You can use these names to construct corresponding cases of an enum, or checking which branch an enum value belongs to in pattern matching:

```moonbit
/// An enum type that represents the ordering relation between two values,
/// with three cases "Smaller", "Greater" and "Equal"
enum Relation {
  Smaller
  Greater
  Equal
}
```

```moonbit
/// compare the ordering relation between two integers
fn compare_int(x : Int, y : Int) -> Relation {
  if x < y {
    // when creating an enum, if the target type is known, 
    // you can write the constructor name directly
    Smaller
  } else if x > y {
    // but when the target type is not known,
    // you can always use `TypeName::Constructor` to create an enum unambiguously
    Relation::Greater
  } else {
    Equal
  }
}

/// output a value of type `Relation`
fn print_relation(r : Relation) -> Unit {
  // use pattern matching to decide which case `r` belongs to
  match r {
    // during pattern matching, if the type is known, 
    // writing the name of constructor is sufficient
    Smaller => println("smaller!")
    // but you can use the `TypeName::Constructor` syntax 
    // for pattern matching as well
    Relation::Greater => println("greater!")
    Equal => println("equal!")
  }
}
```

```moonbit
fn main {
  print_relation(compare_int(0, 1))
  print_relation(compare_int(1, 1))
  print_relation(compare_int(2, 1))
}
```

```default
smaller!
equal!
greater!
```

Enum cases can also carry payload data. Here’s an example of defining an integer list type using enum:

```moonbit
enum List {
  Nil
  // constructor `Cons` carries additional payload: the first element of the list,
  // and the remaining parts of the list
  Cons(Int, List)
}
```

```moonbit
// In addition to binding payload to variables,
// you can also continue matching payload data inside constructors.
// Here's a function that decides if a list contains only one element
fn is_singleton(l : List) -> Bool {
  match l {
    // This branch only matches values of shape `Cons(_, Nil)`, 
    // i.e. lists of length 1
    Cons(_, Nil) => true
    // Use `_` to match everything else
    _ => false
  }
}

fn print_list(l : List) -> Unit {
  // when pattern-matching an enum with payload,
  // in additional to deciding which case a value belongs to
  // you can extract the payload data inside that case
  match l {
    Nil => println("nil")
    // Here `x` and `xs` are defining new variables 
    // instead of referring to existing variables,
    // if `l` is a `Cons`, then the payload of `Cons` 
    // (the first element and the rest of the list)
    // will be bind to `x` and `xs
    Cons(x, xs) => {
      println("\{x},")
      print_list(xs)
    }
  }
}
```

```moonbit
fn main {
  // when creating values using `Cons`, the payload of by `Cons` must be provided
  let l : List = Cons(1, Cons(2, Nil))
  println(is_singleton(l))
  print_list(l)
}
```

```default
false
1,
2,
nil
```

#### Constructor with labelled arguments

Enum constructors can have labelled argument:

```moonbit
enum E {
  // `x` and `y` are labelled argument
  C(x~ : Int, y~ : Int)
}
```

```moonbit
// pattern matching constructor with labelled arguments
fn f(e : E) -> Unit {
  match e {
    // `label=pattern`
    C(x=0, y=0) => println("0!")
    // `x~` is an abbreviation for `x=x`
    // Unmatched labelled arguments can be omitted via `..`
    C(x~, ..) => println(x)
  }
}
```

```moonbit
fn main {
  f(C(x=0, y=0))
  let x = 0
  f(C(x~, y=1)) // <=> C(x=x, y=1)
}
```

```default
0!
0
```

It is also possible to access labelled arguments of constructors like accessing struct fields in pattern matching:

```moonbit
enum Object {
  Point(x~ : Double, y~ : Double)
  Circle(x~ : Double, y~ : Double, radius~ : Double)
}

type! NotImplementedError  derive(Show)

fn distance_with(self : Object, other : Object) -> Double!NotImplementedError {
  match (self, other) {
    // For variables defined via `Point(..) as p`,
    // the compiler knows it must be of constructor `Point`,
    // so you can access fields of `Point` directly via `p.x`, `p.y` etc.
    (Point(_) as p1, Point(_) as p2) => {
      let dx = p2.x - p1.x
      let dy = p2.y - p1.y
      (dx * dx + dy * dy).sqrt()
    }
    (Point(_), Circle(_)) | (Circle(_), Point(_)) | (Circle(_), Circle(_)) =>
      raise NotImplementedError
  }
}
```

```moonbit
fn main {
  let p1 : Object = Point(x=0, y=0)
  let p2 : Object = Point(x=3, y=4)
  let c1 : Object = Circle(x=0, y=0, radius=2)
  try {
    println(p1.distance_with!(p2))
    println(p1.distance_with!(c1))
  } catch {
    e => println(e)
  }
}
```

```default
5
NotImplementedError
```

#### Constructor with mutable fields

It is also possible to define mutable fields for constructor. This is especially useful for defining imperative data structures:

```moonbit
// A set implemented using mutable binary search tree.
struct Set[X] {
  mut root : Tree[X]
}

fn Set::insert[X : Compare](self : Set[X], x : X) -> Unit {
  self.root = self.root.insert(x, parent=Nil)
}

// A mutable binary search tree with parent pointer
enum Tree[X] {
  Nil
  // only labelled arguments can be mutable
  Node(
    mut value~ : X,
    mut left~ : Tree[X],
    mut right~ : Tree[X],
    mut parent~ : Tree[X]
  )
}

// In-place insert a new element to a binary search tree.
// Return the new tree root
fn Tree::insert[X : Compare](
  self : Tree[X],
  x : X,
  parent~ : Tree[X]
) -> Tree[X] {
  match self {
    Nil => Node(value=x, left=Nil, right=Nil, parent~)
    Node(_) as node => {
      let order = x.compare(node.value)
      if order == 0 {
        // mutate the field of a constructor
        node.value = x
      } else if order < 0 {
        // cycle between `node` and `node.left` created here
        node.left = node.left.insert(x, parent=node)
      } else {
        node.right = node.right.insert(x, parent=node)
      }
      // The tree is non-empty, so the new root is just the original tree
      node
    }
  }
}
```

### Newtype

MoonBit supports a special kind of enum called newtype:

```moonbit
// `UserId` is a fresh new type different from `Int`, 
// and you can define new methods for `UserId`, etc.
// But at the same time, the internal representation of `UserId` 
// is exactly the same as `Int`
type UserId Int

type UserName String
```

Newtypes are similar to enums with only one constructor (with the same name as the newtype itself). So, you can use the constructor to create values of newtype, or use pattern matching to extract the underlying representation of a newtype:

```moonbit
fn main {
  let id : UserId = UserId(1)
  let name : UserName = UserName("John Doe")
  let UserId(uid) = id // uid : Int
  let UserName(uname) = name // uname: String
  println(uid)
  println(uname)
}
```

```default
1
John Doe
```

Besides pattern matching, you can also use `._` to extract the internal representation of newtypes:

```moonbit
fn main {
  let id : UserId = UserId(1)
  let uid : Int = id._
  println(uid)
}
```

```default
1
```

### Type alias

MoonBit supports type alias via the syntax `typealias Name = TargetType`:

```moonbit
pub typealias Index = Int

// type alias are private by default
typealias MapString[X] = Map[String, X]
```

Unlike all other kinds of type declaration above, type alias does not define a new type,
it is merely a type macro that behaves exactly the same as its definition.
So for example one cannot define new methods or implement traits for a type alias.

### Local types

Moonbit supports declaring structs/enums/newtypes at the top of a toplevel
function, which are only visible within the current toplevel function. These
local types can use the generic parameters of the toplevel function but cannot
introduce additional generic parameters themselves. Local types can derive
methods using derive, but no additional methods can be defined manually. For
example:

```moonbit
fn toplevel[T: Show](x: T) -> Unit {
  enum LocalEnum {
    A(T)
    B(Int)
  } derive(Show)
  struct LocalStruct {
    a: (String, T)
  } derive(Show)
  type LocalNewtype T derive(Show)
  ...
}
```

Currently, local types do not support being declared as error types.

## Pattern Matching

Pattern matching allows us to match on specific pattern and bind data from data structures.

### Simple Patterns

We can pattern match expressions against

- literals, such as boolean values, numbers, chars, strings, etc
- constants
- structs
- enums
- arrays
- maps
- JSONs

and so on. We can define identifiers to bind the matched values so that they can be used later.

```moonbit
const ONE = 1

fn match_int(x : Int) -> Unit {
  match x {
    0 => println("zero")
    ONE => println("one")
    value => println(value)
  }
}
```

We can use `_` as wildcards for the values we don’t care about, and use `..` to ignore remaining fields of struct or enum, or array (see [array pattern]()).

```moonbit
struct Point3D {
  x : Int
  y : Int
  z : Int
}

fn match_point3D(p : Point3D) -> Unit {
  match p {
    { x: 0, .. } => println("on yz-plane")
    _ => println("not on yz-plane")
  }
}

enum Point[T] {
  Point2D(Int, Int, name~: String, payload~ : T)
}

fn match_point[T](p : Point[T]) -> Unit {
  match p {
    //! Point2D(0, 0) => println("2D origin")
    Point2D(0, 0, ..) => println("2D origin")
    Point2D(_) => println("2D point")
    _ => panic()
  }
}
```

We can use `as` to give a name to some pattern, and we can use `|` to match several cases at once. A variable name can only be bound once in a single pattern, and the same set of variables should be bound on both sides of `|` patterns.

```moonbit
match expr {
  //! Add(e1, e2) | Lit(e1) => ...
  Lit(n) as a => ...
  Add(e1, e2) | Mul(e1, e2) => ...
  _ => ...
}
```

### Array Pattern

For `Array`, `FixedArray` and `ArrayView`, MoonBit allows using array pattern.

Array pattern have the following forms:

- `[]` : matching for an empty data structure
- `[pa, pb, pc]` : matching for known number of elements, 3 in this example
- `[pa, ..]` : matching for known number of elements, followed by unknown number of elements
- `[.., pa]` : matching for known number of elements, preceded by unknown number of elements

```moonbit
test {
  let ary = [1, 2, 3, 4]
  let [a, b, ..] = ary
  inspect!("a = \{a}, b = \{b}", content="a = 1, b = 2")
  let [.., a, b] = ary
  inspect!("a = \{a}, b = \{b}", content="a = 3, b = 4")
}
```

### Range Pattern

For builtin integer types and `Char`, MoonBit allows matching whether the value falls in a specific range.

Range patterns have the form `a..<b` or `a..=b`, where `..<` means the upper bound is exclusive, and `..=` means inclusive upper bound.
`a` and `b` can be one of:

- literal
- named constant declared with `const`
- `_`, meaning the pattern has no restriction on this side

Here are some examples:

```moonbit
const Zero = 0

fn sign(x : Int) -> Int {
  match x {
    _..<Zero => -1
    Zero => 0
    1..<_ => 1
  }
}

fn classify_char(c : Char) -> String {
  match c {
    'a'..='z' => "lowercase"
    'A'..='Z' => "uppercase"
    '0'..='9' => "digit"
    _ => "other"
  }
}
```

### Map Pattern

MoonBit allows convenient matching on map-like data structures.
Inside a map pattern, the `key : value` syntax will match if `key` exists in the map, and match the value of `key` with pattern `value`.
The `key? : value` syntax will match no matter `key` exists or not, and `value` will be matched against `map[key]` (an optional).

```moonbit
match map {
  // matches if any only if "b" exists in `map`
  { "b": _ } => ...
  // matches if and only if "b" does not exist in `map` and "a" exists in `map`.
  // When matches, bind the value of "a" in `map` to `x`
  { "b"? : None, "a": x } => ...
  // compiler reports missing case: { "b"? : None, "a"? : None }
}
```

- To match a data type `T` using map pattern, `T` must have a method `op_get(Self, K) -> Option[V]` for some type `K` and `V` (see [method and trait](methods.md)).
- Currently, the key part of map pattern must be a literal or constant
- Map patterns are always open: unmatched keys are silently ignored
- Map pattern will be compiled to efficient code: every key will be fetched at most once

### Json Pattern

When the matched value has type `Json`, literal patterns can be used directly, together with constructors:

```moonbit
match json {
  { "version": "1.0.0", "import": [..] as imports } => ...
  { "version": Number(i), "import": Array(imports)} => ...
  _ => ...
}
```

## Generics

Generics are supported in top-level function and data type definitions. Type parameters can be introduced within square brackets. We can rewrite the aforementioned data type `List` to add a type parameter `T` to obtain a generic version of lists. We can then define generic functions over lists like `map` and `reduce`.

```moonbit
enum List[T] {
  Nil
  Cons(T, List[T])
}

fn map[S, T](self : List[S], f : (S) -> T) -> List[T] {
  match self {
    Nil => Nil
    Cons(x, xs) => Cons(f(x), map(xs, f))
  }
}

fn reduce[S, T](self : List[S], op : (T, S) -> T, init : T) -> T {
  match self {
    Nil => init
    Cons(x, xs) => reduce(xs, op, op(init, x))
  }
}
```

## Special Syntax

### Pipe operator

MoonBit provides a convenient pipe operator `|>`, which can be used to chain regular function calls:

```moonbit
5 |> ignore // <=> ignore(5)
[] |> push(5) // <=> push([], 5)
1
|> add(5) // <=> add(1, 5)
|> ignore // <=> ignore(add(1, 5))
```

### Cascade Operator

The cascade operator `..` is used to perform a series of mutable operations on
the same value consecutively. The syntax is as follows:

```moonbit
x..f()
```

`x..f()..g()` is equivalent to `{x.f(); x.g(); x}`.

Consider the following scenario: for a `StringBuilder` type that has methods
like `write_string`, `write_char`, `write_object`, etc., we often need to perform
a series of operations on the same `StringBuilder` value:

```moonbit
let builder = StringBuilder::new()
builder.write_char('a')
builder.write_char('a')
builder.write_object(1001)
builder.write_string("abcdef")
let result = builder.to_string()
```

To avoid repetitive typing of `builder`, its methods are often designed to
return `self` itself, allowing operations to be chained using the `.` operator.
To distinguish between immutable and mutable operations, in MoonBit,
for all methods that return `Unit`, cascade operator can be used for
consecutive operations without the need to modify the return type of the methods.

```moonbit
let result = StringBuilder::new()
  ..write_char('a')
  ..write_char('a')
  ..write_object(1001)
  ..write_string("abcdef")
  .to_string()
```

### TODO syntax

The `todo` syntax (`...`) is a special construct used to mark sections of code that are not yet implemented or are placeholders for future functionality. For example:

```moonbit
fn todo_in_func() -> Int {
  ...
}
```


# Method and Trait

## Method system

MoonBit supports methods in a different way from traditional object-oriented languages. A method in MoonBit is just a toplevel function associated with a type constructor. Methods can be defined using the syntax `fn TypeName::method_name(...) -> ...`:

```moonbit
enum List[X] {
  Nil
  Cons(X, List[X])
}

fn List::concat[X](xs : List[List[X]]) -> List[X] {
  ...
}
```

As a convenient shorthand, when the first parameter of a function is named `self`, MoonBit automatically defines the function as a method of the type of `self`:

```moonbit
fn List::map[X, Y](xs : List[X], f : (X) -> Y) -> List[Y] {
  ...
}
```

is equivalent to:

```moonbit
fn map[X, Y](self : List[X], f : (X) -> Y) -> List[Y] {
  ...
}
```

Methods are just regular functions owned by a type constructor. So when there is no ambiguity, methods can be called using regular function call syntax directly:

```moonbit
let xs : List[List[_]] = { ... }
let ys = concat(xs)
```

Unlike regular functions, methods support overloading: different types can define methods of the same name. If there are multiple methods of the same name (but for different types) in scope, one can still call them by explicitly adding a `TypeName::` prefix:

```moonbit
struct T1 {
  x1 : Int
}

fn T1::default() -> T1 {
  { x1: 0 }
}

struct T2 {
  x2 : Int
}

fn T2::default() -> T2 {
  { x2: 0 }
}

test {
  // default() : T1::default() ? T2::default()?
  let t1 = T1::default()
  let t2 = T2::default()

}
```

When the first parameter of a method is also the type it belongs to, methods can be called using dot syntax `x.method(...)`. MoonBit automatically finds the correct method based on the type of `x`, there is no need to write the type name and even the package name of the method:

```moonbit
pub(all) enum List[X] {
  Nil
  Cons(X, List[X])
}

pub fn List::concat[X](xs : List[List[X]]) -> List[X] {
  ...
}
```

```moonbit
fn f() -> Unit {
  let xs : @list.List[@list.List[Unit]] = Nil
  let _ = xs.concat()
  let _ = @list.List::concat(xs)
  let _ = @list.concat(xs)

}
```

The highlighted line is only possible when there is no ambiguity in `@list`.

## Operator Overloading

MoonBit supports operator overloading of builtin operators via methods. The method name corresponding to a operator `<op>` is `op_<op>`. For example:

```moonbit
struct T {
  x : Int
}

fn op_add(self : T, other : T) -> T {
  { x: self.x + other.x }
}

test {
  let a = { x: 0 }
  let b = { x: 2 }
  assert_eq!((a + b).x, 2)
}
```

Another example about `op_get` and `op_set`:

```moonbit
struct Coord {
  mut x : Int
  mut y : Int
} derive(Show)

fn op_get(self : Coord, key : String) -> Int {
  match key {
    "x" => self.x
    "y" => self.y
  }
}

fn op_set(self : Coord, key : String, val : Int) -> Unit {
  match key {
    "x" => self.x = val
    "y" => self.y = val
  }
}
```

```moonbit
fn main {
  let c = { x: 1, y: 2 }
  println(c)
  println(c["y"])
  c["x"] = 23
  println(c)
  println(c["x"])
}
```

```default
{x: 1, y: 2}
2
{x: 23, y: 2}
23
```

Currently, the following operators can be overloaded:

| Operator Name         | Method Name   |
|-----------------------|---------------|
| `+`                   | `op_add`      |
| `-`                   | `op_sub`      |
| `*`                   | `op_mul`      |
| `/`                   | `op_div`      |
| `%`                   | `op_mod`      |
| `=`                   | `op_equal`    |
| `<<`                  | `op_shl`      |
| `>>`                  | `op_shr`      |
| `-` (unary)           | `op_neg`      |
| `_[_]` (get item)     | `op_get`      |
| `_[_] = _` (set item) | `op_set`      |
| `_[_:_]` (view)       | `op_as_view`  |
| `&`                   | `land`        |
| `|`                   | `lor`         |
| `^`                   | `lxor`        |
| `<<`                  | `op_shl`      |
| `>>`                  | `op_shr`      |

By implementing `op_as_view` method, you can create a view for a user-defined type. Here is an example:

```moonbit
type DataView String

struct Data {}

fn Data::op_as_view(_self : Data, start~ : Int = 0, end? : Int) -> DataView {
  "[\{start}, \{end.or(100)})"
}

test {
  let data = Data::{  }
  inspect!(data[:]._, content="[0, 100)")
  inspect!(data[2:]._, content="[2, 100)")
  inspect!(data[:5]._, content="[0, 5)")
  inspect!(data[2:5]._, content="[2, 5)")
}
```

## Trait system

MoonBit features a structural trait system for overloading/ad-hoc polymorphism. Traits declare a list of operations, which must be supplied when a type wants to implement the trait. Traits can be declared as follows:

```moonbit
trait I {
  method_(Int) -> Int
  method_with_label(Int, label~: Int) -> Int
  //! method_with_label(Int, label?: Int) -> Int
}
```

In the body of a trait definition, a special type `Self` is used to refer to the type that implements the trait.

### Extending traits

A trait can depend on other traits, for example:

```moonbit
trait Position {
  pos(Self) -> (Int, Int)
}
trait Draw {
  draw(Self) -> Unit
}

trait Object : Position + Draw {}
```

To implement the sub trait, one will have to implement the super traits,
and the methods defined in the sub trait.

### Implementing traits

To implement a trait, a type must provide all the methods required by the trait.

This allows types to implement a trait implicitly, hence allowing different packages to work together without seeing or depending on each other.
For example, the following trait is automatically implemented for builtin number types such as `Int` and `Double`:

```moonbit
trait Number {
  op_add(Self, Self) -> Self
  op_mul(Self, Self) -> Self
}
```

**Explicit implementation** for trait methods can be provided via the syntax `impl Trait for Type with method_name(...) { ... }`, for example:

```moonbit
trait MyShow {
  to_string(Self) -> String
}

struct MyType {}

impl MyShow for MyType with to_string(self) { ... }

struct MyContainer[T] {}

// trait implementation with type parameters.
// `[X : Show]` means the type parameter `X` must implement `Show`,
// this will be covered later.
impl[X : MyShow] MyShow for MyContainer[X] with to_string(self) { ... }
```

Type annotation can be omitted for trait `impl`: MoonBit will automatically infer the type based on the signature of `Trait::method` and the self type.

The author of the trait can also define **default implementations** for some methods in the trait, for example:

```moonbit
trait J {
  f(Self) -> Unit
  f_twice(Self) -> Unit
}

impl J with f_twice(self) {
  self.f()
  self.f()
}
```

Implementers of trait `I` don’t have to provide an implementation for `f_twice`: to implement `I`, only `f` is necessary.
They can always override the default implementation with an explicit `impl I for Type with f_twice`, if desired, though.

If an explicit `impl` or default implementation is not found, trait method resolution falls back to regular methods.

### Using traits

When declaring a generic function, the type parameters can be annotated with the traits they should implement, allowing the definition of constrained generic functions. For example:

```moonbit
fn square[N : Number](x : N) -> N {
  x * x // <=> x.op_mul(x)
}
```

Without the `Number` requirement, the expression `x * x` in `square` will result in a method/operator not found error. Now, the function `square` can be called with any type that implements `Number`, for example:

```moonbit
struct Point {
  x : Int
  y : Int
} derive(Eq, Show)

impl Number for Point with op_add(self, other) {
  { x: self.x + other.x, y: self.y + other.y }
}

impl Number for Point with op_mul(self, other) {
  { x: self.x * other.x, y: self.y * other.y }
}

test {
  assert_eq!(square(2), 4)
  assert_eq!(square(1.5), 2.25)
  assert_eq!(square(Point::{ x: 2, y: 3 }), { x: 4, y: 9 })
}
```

#### Invoke trait methods directly

Methods of a trait can be called directly via `Trait::method`. MoonBit will infer the type of `Self` and check if `Self` indeed implements `Trait`, for example:

```moonbit
test {
  assert_eq!(Show::to_string(42), "42")
  assert_eq!(Compare::compare(1.0, 2.5), -1)
}
```

Trait implementations can also be invoked via dot syntax, with the following restrictions:

1. if a regular method is present, the regular method is always favored when using dot syntax
2. only trait implementations that are located in the package of the self type can be invoked via dot syntax
   - if there are multiple trait methods (from different traits) with the same name available, an ambiguity error is reported
3. if neither of the above two rules apply, trait `impl`s in current package will also be searched for dot syntax.
   This allows extending a foreign type locally.
   - these `impl`s can only be called via dot syntax locally, even if they are public.

The above rules ensures that MoonBit’s dot syntax enjoys good property while being flexible.
For example, adding a new dependency never break existing code with dot syntax due to ambiguity.
These rules also make name resolution of MoonBit extremely simple:
the method called via dot syntax must always come from current package or the package of the type!

Here’s an example of calling trait `impl` with dot syntax:

```moonbit
struct MyCustomType {}

impl Show for MyCustomType with output(self, logger) { ... }

fn f() -> Unit {
  let x = MyCustomType::{  }
  let _ = x.to_string()

}
```

## Trait objects

MoonBit supports runtime polymorphism via trait objects.
If `t` is of type `T`, which implements trait `I`,
one can pack the methods of `T` that implements `I`, together with `t`,
into a runtime object via `t as &I`.
Trait object erases the concrete type of a value,
so objects created from different concrete types can be put in the same data structure and handled uniformly:

```moonbit
trait Animal {
  speak(Self) -> String
}

type Duck String

fn Duck::make(name : String) -> Duck {
  Duck(name)
}

fn speak(self : Duck) -> String {
  "\{self._}: quack!"
}

type Fox String

fn Fox::make(name : String) -> Fox {
  Fox(name)
}

fn Fox::speak(_self : Fox) -> String {
  "What does the fox say?"
}

test {
  let duck1 = Duck::make("duck1")
  let duck2 = Duck::make("duck2")
  let fox1 = Fox::make("fox1")
  let animals : Array[&Animal] = [
    duck1 as &Animal,
    duck2 as &Animal,
    fox1 as &Animal,
  ]
  inspect!(
    animals.map(fn(animal) { animal.speak() }),
    content=
      #|["duck1: quack!", "duck2: quack!", "What does the fox say?"]
    ,
  )
}
```

Not all traits can be used to create objects.
“object-safe” traits’ methods must satisfy the following conditions:

- `Self` must be the first parameter of a method
- There must be only one occurrence of `Self` in the type of the method (i.e. the first parameter)

Users can define new methods for trait objects, just like defining new methods for structs and enums:

```moonbit
trait Logger {
  write_string(Self, String) -> Unit
}

trait CanLog {
  log(Self, &Logger) -> Unit
}

fn &Logger::write_object[Obj : CanLog](self : &Logger, obj : Obj) -> Unit {
  obj.log(self)
}

// use the new method to simplify code
impl[A : CanLog, B : CanLog] CanLog for (A, B) with log(self, logger) {
  let (a, b) = self
  logger
  ..write_string("(")
  ..write_object(a)
  ..write_string(", ")
  ..write_object(b)
  .write_string(")")
}
```

## Builtin traits

MoonBit provides the following useful builtin traits:

<!-- MANUAL CHECK https://github.com/moonbitlang/core/blob/80cf250d22a5d5eff4a2a1b9a6720026f2fe8e38/builtin/traits.mbt -->
```moonbit
trait Eq {
  op_equal(Self, Self) -> Bool
}

trait Compare : Eq {
  // `0` for equal, `-1` for smaller, `1` for greater
  compare(Self, Self) -> Int
}

trait Hash {
  hash_combine(Self, Hasher) -> Unit // to be implemented
  hash(Self) -> Int // has default implementation
}

trait Show {
  output(Self, Logger) -> Unit // to be implemented
  to_string(Self) -> String // has default implementation
}

trait Default {
  default() -> Self
}
```

### Deriving builtin traits

MoonBit can automatically derive implementations for some builtin traits:

```moonbit
struct T {
  x : Int
  y : Int
} derive(Eq, Compare, Show, Default)

test {
  let t1 = T::default()
  let t2 = T::{ x: 1, y: 1 }
  inspect!(t1, content="{x: 0, y: 0}")
  inspect!(t2, content="{x: 1, y: 1}")
  assert_not_eq!(t1, t2)
  assert_true!(t1 < t2)
}
```


# Managing Projects with Packages

When developing projects at large scale, the project usually needs to be divided into smaller modular unit that depends on each other.
More often, it involves using other people’s work: most noticeably is the [core](https://github.com/moonbitlang/core), the standard library of MoonBit.

## Packages and modules

In MoonBit, the most important unit for code organization is a package, which consists of a number of source code files and a single `moon.pkg.json` configuration file.
A package can either be a `main` package, consisting a `main` function, or a package that serves as a library.

A project, corresponding to a module, consists of multiple packages and a single `moon.mod.json` configuration file.

When using things from another package, the dependency between modules should first be declared inside the `moon.mod.json`.
The dependency between packages should then be declared inside the `moon.pkg.json`.
Then it is possible to use `@pkg` to access the imported entities, where `pkg` is the last part of the imported package’s path or the declared alias in `moon.pkg.json`:

```json
{
    "import": [
        "moonbit-community/language/packages/pkgA"
    ]
}
```

```moonbit
pub fn add1(x : Int) -> Int {
  @pkgA.incr(x)
}
```

## Access Control

By default, all function definitions and variable bindings are *invisible* to other packages.
You can use the `pub` modifier before toplevel `let`/`fn` to make them public.

There are four different kinds of visibility for types in MoonBit:

- private type, declared with `priv`, completely invisible to the outside world
- abstract type, which is the default visibility for types. Only the name of an abstract type is visible outside, the internal representation of the type is hidden
- readonly types, declared with `pub(readonly)`. The internal representation of readonly types are visible outside,
  but users can only read the values of these types from outside, construction and mutation are not allowed
- fully public types, declared with `pub(all)`. The outside world can freely construct, modify and read values of these types

#### WARNING
Currently, the semantic of `pub` is `pub(all)`. But in the future, the meaning of `pub` will be ported to `pub(readonly)`.

In addition to the visibility of the type itself, the fields of a public `struct` can be annotated with `priv`,
which will hide the field from the outside world completely.
Note that `struct`s with private fields cannot be constructed directly outside,
but you can update the public fields using the functional struct update syntax.

Readonly types is a very useful feature, inspired by [private types](https://v2.ocaml.org/manual/privatetypes.html) in OCaml. In short, values of `pub(readonly)` types can be destructed by pattern matching and the dot syntax, but cannot be constructed or mutated in other packages. Note that there is no restriction within the same package where `pub(readonly)` types are defined.

<!-- MANUAL CHECK -->
```moonbit
// Package A
pub(readonly) struct RO {
  field: Int
}
test {
  let r = { field: 4 }       // OK
  let r = { ..r, field: 8 }  // OK
}

// Package B
fn println(r : RO) -> Unit {
  println("{ field: ")
  println(r.field)  // OK
  println(" }")
}
test {
  let r : RO = { field: 4 }  // ERROR: Cannot create values of the public read-only type RO!
  let r = { ..r, field: 8 }  // ERROR: Cannot mutate a public read-only field!
}
```

Access control in MoonBit adheres to the principle that a `pub` type, function, or variable cannot be defined in terms of a private type. This is because the private type may not be accessible everywhere that the `pub` entity is used. MoonBit incorporates sanity checks to prevent the occurrence of use cases that violate this principle.

<!-- MANUAL CHECK -->
```moonbit
pub(all) type T1
pub(all) type T2
priv type T3

pub(all) struct S {
  x: T1  // OK
  y: T2  // OK
  z: T3  // ERROR: public field has private type `T3`!
}

// ERROR: public function has private parameter type `T3`!
pub fn f1(_x: T3) -> T1 { ... }
// ERROR: public function has private return type `T3`!
pub fn f2(_x: T1) -> T3 { ... }
// OK
pub fn f3(_x: T1) -> T1 { ... }

pub let a: T3 = { ... } // ERROR: public variable has private type `T3`!
```

## Access control of methods and trait implementations

To make the trait system coherent (i.e. there is a globally unique implementation for every `Type: Trait` pair),
and prevent third-party packages from modifying behavior of existing programs by accident,
MoonBit employs the following restrictions on who can define methods/implement traits for types:

- *only the package that defines a type can define methods for it*. So one cannot define new methods or override old methods for builtin and foreign types.
- *only the package of the type or the package of the trait can define an implementation*.
  For example, only `@pkg1` and `@pkg2` are allowed to write `impl @pkg1.Trait for @pkg2.Type`.

The second rule above allows one to add new functionality to a foreign type by defining a new trait and implementing it.
This makes MoonBit’s trait & method system flexible while enjoying good coherence property.

## Visibility of traits and sealed traits

There are four visibility for traits, just like `struct` and `enum`: private, abstract, readonly and fully public.
Private traits are declared with `priv trait`, and they are completely invisible from outside.
Abstract trait is the default visibility. Only the name of the trait is visible from outside, and the methods in the trait are not exposed.
Readonly traits are declared with `pub(readonly) trait`, their methods can be involked from outside, but only the current package can add new implementation for readonly traits.
Finally, fully public traits are declared with `pub(open) trait`, they are open to new implementations outside current package, and their methods can be freely used.

#### WARNING
Currently, `pub trait` defaults to `pub(open) trait`. But in the future, the semantic of `pub trait` will be ported to `pub(readonly)`.

Abstract and readonly traits are sealed, because only the package defining the trait can implement them.
Implementing a sealed (abstract or readonly) trait outside its package result in compiler error.
If you are the owner of a sealed trait, and you want to make some implementation available to users of your package,
make sure there is at least one declaration of the form `impl Trait for Type with ...` in your package.
Implementations with only regular method and default implementations will not be available outside.

Here’s an example of abstract trait:

<!-- MANUAL CHECK -->
```moonbit
trait Number {
 op_add(Self, Self) -> Self
 op_sub(Self, Self) -> Self
}

fn add[N : Number](x : N, y: N) -> N {
  Number::op_add(x, y)
}

fn sub[N : Number](x : N, y: N) -> N {
  Number::op_sub(x, y)
}

impl Number for Int with op_add(x, y) { x + y }
impl Number for Int with op_sub(x, y) { x - y }

impl Number for Double with op_add(x, y) { x + y }
impl Number for Double with op_sub(x, y) { x - y }
```

From outside this package, users can only see the following:

```moonbit
trait Number

fn op_add[N : Number](x : N, y : N) -> N
fn op_sub[N : Number](x : N, y : N) -> N

impl Number for Int
impl Number for Double
```

The author of `Number` can make use of the fact that only `Int` and `Double` can ever implement `Number`,
because new implementations are not allowed outside.


# Writing Tests

Tests are important for improving quality and maintainability of a program. They verify the behavior of a program and also serves as a specification to avoid regressions over time.

MoonBit comes with test support to make the writing easier and simpler.

## Test Blocks

MoonBit provides the test code block for writing inline test cases. For example:

```moonbit
test "test_name" {
  assert_eq!(1 + 1, 2)
  assert_eq!(2 + 2, 4)
  inspect!([1, 2, 3], content="[1, 2, 3]")
}
```

A test code block is essentially a function that returns a `Unit` but may throws a `String` on error, or `Unit!String` as one would see in its signature at the position of return type. It is called during the execution of `moon test` and outputs a test report through the build system. The `assert_eq` function is from the standard library; if the assertion fails, it prints an error message and terminates the test. The string `"test_name"` is used to identify the test case and is optional.

If a test name starts with `"panic"`, it indicates that the expected behavior of the test is to trigger a panic, and the test will only pass if the panic is triggered. For example:

```moonbit
test "panic_test" {
  let _ : Int = Option::None.unwrap()

}
```

## Snapshot Tests

Writing tests can be tedious when specifying the expected values. Thus, MoonBit provides three kinds of snapshot tests.
All of which can be inserted or updated automatically using `moon test --update`.

### Snapshotting `Show`

We can use `inspect!(x, content="x")` to inspect anything that implements `Show` trait.
As we mentioned before, `Show` is a builtin trait that can be derived, providing `to_string` that will print the content of the data structures.
The labelled argument `content` can be omitted as `moon test --update` will insert it for you:

```moonbit
struct X { x : Int } derive(Show)

test "show snapshot test" {
  inspect!({x: 10}, content="{x: 10}")
}
```

### Snapshotting `JSON`

The problem with the derived `Show` trait is that it does not perform pretty printing, resulting in extremely long output.

The solution is to use `@json.inspect!(x, content=x)`. The benefit is that the resulting content is a JSON structure, which can be more readable after being formatted.

```moonbit
enum Rec {
  End
  Really_long_name_that_is_difficult_to_read(Rec)
} derive(Show, ToJson)

test "json snapshot test" {
  let r = Really_long_name_that_is_difficult_to_read(
    Really_long_name_that_is_difficult_to_read(
      Really_long_name_that_is_difficult_to_read(End),
    ),
  )
  inspect!(
    r,
    content="Really_long_name_that_is_difficult_to_read(Really_long_name_that_is_difficult_to_read(Really_long_name_that_is_difficult_to_read(End)))",
  )
  @json.inspect!(
    r,
    content={
      "$tag": "Really_long_name_that_is_difficult_to_read",
      "0": {
        "$tag": "Really_long_name_that_is_difficult_to_read",
        "0": {
          "$tag": "Really_long_name_that_is_difficult_to_read",
          "0": { "$tag": "End" },
        },
      },
    },
  )
}
```

One can also implement a custom `ToJson` to keep only the essential information.

### Snapshotting Anything

Still, sometimes we want to not only record one data structure but the output of a whole process.

A full snapshot test can be used to record anything using `@test.T::write` and `@test.T::writeln`:

```moonbit
test "record anything" (t : @test.T) {
  t.write("Hello, world!")
  t.writeln(" And hello, MoonBit!")
  t.snapshot!(filename="record_anything.txt")
}
```

This will create a file under `__snapshot__` of that package with the given filename:

```default
Hello, world! And hello, MoonBit!
```

This can also be used for applications to test the generated output, whether it were creating an image, a video or some custom data.

## BlackBox Tests and WhiteBox Tests

When developing libraries, it is important to verify if the user can use it correctly. For example, one may forget to make a type or a function public. That’s why MoonBit provides BlackBox tests, allowing developers to have a grasp of how others are feeling.

- A test that has access to all the members in a package is called a WhiteBox tests as we can see everything. Such tests can be defined inline or defined in a file whose name ends with `_wbtest.mbt`.
- A test that has access only to the public members in a package is called a BlackBox tests. Such tests need to be defined in a file whose name ends with `_test.mbt`.

The WhiteBox test files (`_wbtest.mbt`) imports the packages defined in the `import` and `wbtest-import` sections of the package configuration (`moon.pkg.json`).

The BlackBox test files (`_test.mbt`) imports the current package and the packages defined in the `import` and `test-import` sections of the package configuration (`moon.pkg.json`).


