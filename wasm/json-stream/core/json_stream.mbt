// Phase 3 JSON stream parser.
//
// 正交意图：
// 1. 原始需求（2026-10-06）：MoonBit 核心必须按 RFC 8259 增量解析 JSON。
// 2. 解析状态跨 chunk 保存字符串、数字、字面量和嵌套容器。
// 3. 事件 offset 使用 UTF-8 字节边界，供 JS 行模型和 WASM ABI 复用。
// 4. 预览最多保留 120 个输入字节，巨值不复制到解析状态。
//
// 适配边界：解析核心保持 Bytes API；经典 wasm ABI 在外层用内联
// i32.load8_u 将共享线性内存的 ptr+len 窗口转换为 Bytes。

///| JSON 容器种类，与 TS StreamEvent 的 kind 一一对应。
pub enum ContainerKind {
  Object
  Array
} derive(Eq, Show)

///| JSON 标量种类，与 TS StreamEvent 的 kind 一一对应。
pub enum ScalarKind {
  String
  Number
  Boolean
  Null
} derive(Eq, Show)

///| 解析事件类型。
pub enum EventKind {
  StartObject
  EndObject
  StartArray
  EndArray
  Key
  Scalar
} derive(Eq, Show)

///| 事件流中的一个 token 边界副产品。
pub(all) struct Event {
  pub kind : EventKind
  pub scalar_kind : ScalarKind?
  pub start : Int
  pub end : Int
  pub depth : Int
  pub preview : String
  pub skipped : Bool
} derive(Eq, Show)

///| 与 JS stream-protocol.ts 对齐的错误码。
pub enum ErrorCode {
  UnexpectedChar
  UnterminatedString
  InvalidEscape
  InvalidNumber
  InvalidUtf8
  ExpectedValue
  ExpectedColon
  ExpectedCommaOrClose
  TrailingContent
  TooDeep
  InputTooLarge
} derive(Eq, Show)

///| 错误位置使用字节 offset，同时提供人类可读的行列。
pub(all) struct ParseError {
  pub code : ErrorCode
  pub offset : Int
  pub line : Int
  pub column : Int
  pub message : String
} derive(Eq, Show)

pub enum FrameState {
  Empty
  Key
  Colon
  Value
  Comma
} derive(Eq)

pub(all) struct Frame {
  kind : ContainerKind
  mut state : FrameState
  start : Int
} derive(Eq)

pub enum Mode {
  Normal
  String
  Number
  Literal
} derive(Eq)

pub enum NumberState {
  Sign
  Zero
  Integer
  FractionStart
  Fraction
  ExponentStart
  ExponentSign
  ExponentDigits
} derive(Eq)

///| 供 step/skip_to/snapshot/resume 使用的紧凑上下文。
pub(all) struct Ctx {
  pub mut offset : Int
  pub mut line : Int
  pub mut column : Int
  pub mut depth : Int
  pub mut root_started : Bool
  pub mut root_done : Bool
  pub mut mode : Mode
  pub mut number_state : NumberState
  pub mut token_start : Int
  pub mut token_preview : Array[Byte]
  pub mut literal : String
  pub mut literal_index : Int
  pub mut string_escaped : Bool
  pub mut string_unicode_remaining : Int
  pub mut string_is_key : Bool
  pub mut utf8_remaining : Int
  pub mut utf8_codepoint : Int
  pub mut utf8_expected : Int
  pub mut stack : Array[Frame]
  pub mut values : Int
  pub mut max_depth : Int
  pub mut error : ParseError?
} derive(Eq)

///| step 的结构化返回值。
pub(all) struct StepResult {
  pub next : Ctx
  pub events : Array[Event]
  pub done : Bool
  pub error : ParseError?
} derive(Eq)

///| 创建空上下文。
pub fn new_ctx() -> Ctx {
  {
    offset: 0,
    line: 1,
    column: 1,
    depth: 0,
    root_started: false,
    root_done: false,
    mode: Normal,
    number_state: Sign,
    token_start: -1,
    token_preview: [],
    literal: "",
    literal_index: 0,
    string_escaped: false,
    string_unicode_remaining: 0,
    string_is_key: false,
    utf8_remaining: 0,
    utf8_codepoint: 0,
    utf8_expected: 0,
    stack: [],
    values: 0,
    max_depth: 0,
    error: None,
  }
}

fn copy_frame(frame : Frame) -> Frame {
  { kind: frame.kind, state: frame.state, start: frame.start }
}

fn clone_ctx(ctx : Ctx) -> Ctx {
  {
    ..ctx,
    token_preview: ctx.token_preview.copy(),
    stack: ctx.stack.map(copy_frame),
    error: ctx.error,
  }
}

///| 保存上下文快照。内部数组会复制，调用方可安全继续 step。
pub fn snapshot(ctx : Ctx) -> Ctx {
  clone_ctx(ctx)
}

///| 从快照恢复上下文。
pub fn resume(ctx : Ctx) -> Ctx {
  clone_ctx(ctx)
}

fn make_error(ctx : Ctx, code : ErrorCode, offset : Int, message : String) -> ParseError {
  { code, offset, line: ctx.line, column: ctx.column, message }
}

fn set_error(ctx : Ctx, error : ParseError) -> Unit {
  ctx.error = Some(error)
}

fn is_digit(ch : Byte) -> Bool {
  ch >= b'0' && ch <= b'9'
}

fn is_hex(ch : Byte) -> Bool {
  (ch >= b'0' && ch <= b'9') ||
    (ch >= b'a' && ch <= b'f') ||
    (ch >= b'A' && ch <= b'F')
}

fn is_delimiter(ch : Byte) -> Bool {
  ch == b' ' || ch == b'\n' || ch == b'\r' || ch == b'\t' ||
    ch == b',' || ch == b']' || ch == b'}' || ch == b':'
}

fn preview_append(ctx : Ctx, ch : Byte) -> Unit {
  if ctx.token_preview.length() < 120 {
    ctx.token_preview.push(ch)
  }
}

fn preview_string(ctx : Ctx) -> String {
  @utf8.decode_lossy(Bytes::from_array(ctx.token_preview)[:])
}

///| 创建解析错误。
fn start_value(ctx : Ctx) -> ParseError? {
  if ctx.root_done {
    return Some(make_error(ctx, TrailingContent, ctx.offset, "根值结束后存在多余内容"))
  }
  if !ctx.root_started {
    ctx.root_started = true
    return None
  }
  guard ctx.stack.length() > 0 else {
    return Some(make_error(ctx, ExpectedCommaOrClose, ctx.offset, "值之间缺少逗号"))
  }
  let parent = ctx.stack[ctx.stack.length() - 1]
  if parent.kind == Array && parent.state == Empty {
    parent.state = Value
    return None
  }
  if parent.state == Value {
    return None
  }
  Some(make_error(ctx, ExpectedCommaOrClose, ctx.offset, "值之间缺少逗号"))
}

fn finish_value(ctx : Ctx) -> Unit {
  if ctx.stack.length() == 0 {
    ctx.root_done = true
  } else {
    ctx.stack[ctx.stack.length() - 1].state = Comma
  }
}

fn finish_scalar(
  ctx : Ctx,
  kind : ScalarKind,
  end : Int,
  events : Array[Event],
) -> Unit {
  let preview = preview_string(ctx)
  events.push({
    kind: Scalar,
    scalar_kind: Some(kind),
    start: ctx.token_start,
    end,
    depth: ctx.depth + 1,
    preview,
    skipped: kind == String && end - ctx.token_start > 128,
  })
  ctx.values += 1
  ctx.mode = Normal
  ctx.token_start = -1
  ctx.token_preview = []
  ctx.literal = ""
  ctx.literal_index = 0
  ctx.string_is_key = false
  finish_value(ctx)
}

fn finish_container(ctx : Ctx, kind : ContainerKind, events : Array[Event]) -> Unit {
  let index = ctx.stack.length() - 1
  let frame = ctx.stack[index]
  events.push({
    kind: if kind == Object { EndObject } else { EndArray },
    scalar_kind: None,
    start: frame.start,
    end: ctx.offset + 1,
    depth: ctx.depth,
    preview: "",
    skipped: false,
  })
  ignore(ctx.stack.pop())
  ctx.depth -= 1
  if ctx.stack.length() == 0 {
    ctx.root_done = true
  } else {
    ctx.stack[ctx.stack.length() - 1].state = Comma
  }
}

fn valid_number_state(state : NumberState) -> Bool {
  match state {
    Zero | Integer | Fraction | ExponentDigits => true
    _ => false
  }
}

fn advance_number(ctx : Ctx, ch : Byte) -> Bool {
  match ctx.number_state {
    Sign =>
      if !is_digit(ch) {
        false
      } else {
        ctx.number_state = if ch == b'0' { Zero } else { Integer }
        true
      }
    Zero =>
      if ch == b'.' {
        ctx.number_state = FractionStart
        true
      } else if ch == b'e' || ch == b'E' {
        ctx.number_state = ExponentStart
        true
      } else {
        false
      }
    Integer =>
      if is_digit(ch) {
        true
      } else if ch == b'.' {
        ctx.number_state = FractionStart
        true
      } else if ch == b'e' || ch == b'E' {
        ctx.number_state = ExponentStart
        true
      } else {
        false
      }
    FractionStart =>
      if is_digit(ch) {
        ctx.number_state = Fraction
        true
      } else {
        false
      }
    Fraction =>
      if is_digit(ch) {
        true
      } else if ch == b'e' || ch == b'E' {
        ctx.number_state = ExponentStart
        true
      } else {
        false
      }
    ExponentStart =>
      if ch == b'+' || ch == b'-' {
        ctx.number_state = ExponentSign
        true
      } else if is_digit(ch) {
        ctx.number_state = ExponentDigits
        true
      } else {
        false
      }
    ExponentSign =>
      if is_digit(ch) {
        ctx.number_state = ExponentDigits
        true
      } else {
        false
      }
    ExponentDigits => is_digit(ch)
  }
}

fn utf8_accept(ctx : Ctx, ch : Byte) -> Bool {
  let byte = ch.to_int()
  if ctx.utf8_remaining > 0 {
    if byte < 0x80 || byte > 0xBF {
      return false
    }
    ctx.utf8_codepoint = (ctx.utf8_codepoint << 6) | (byte & 0x3F)
    ctx.utf8_remaining -= 1
    if ctx.utf8_remaining == 0 {
      let codepoint = ctx.utf8_codepoint
      let valid = if ctx.utf8_expected == 2 {
        codepoint >= 0x80
      } else if ctx.utf8_expected == 3 {
        codepoint >= 0x800 && !(codepoint >= 0xD800 && codepoint <= 0xDFFF)
      } else {
        codepoint >= 0x10000 && codepoint <= 0x10FFFF
      }
      ctx.utf8_expected = 0
      return valid
    }
    return true
  }
  if byte <= 0x7F {
    true
  } else if byte >= 0xC2 && byte <= 0xDF {
    ctx.utf8_remaining = 1
    ctx.utf8_codepoint = byte & 0x1F
    ctx.utf8_expected = 2
    true
  } else if byte >= 0xE0 && byte <= 0xEF {
    ctx.utf8_remaining = 2
    ctx.utf8_codepoint = byte & 0x0F
    ctx.utf8_expected = 3
    true
  } else if byte >= 0xF0 && byte <= 0xF4 {
    ctx.utf8_remaining = 3
    ctx.utf8_codepoint = byte & 0x07
    ctx.utf8_expected = 4
    true
  } else {
    false
  }
}

fn consume_position(ctx : Ctx, ch : Byte) -> Unit {
  ctx.offset += 1
  if ch == b'\n' {
    ctx.line += 1
    ctx.column = 1
  } else {
    ctx.column += 1
  }
}

fn expected_literal(ctx : Ctx, ch : Byte) -> Bool {
  let next = ctx.literal_index + 1
  if next >= ctx.literal.length() {
    false
  } else {
    ctx.literal[next].to_int() == ch.to_int()
  }
}

fn begin_string(ctx : Ctx, is_key : Bool) -> Unit {
  ctx.mode = String
  ctx.string_is_key = is_key
  ctx.token_start = ctx.offset
  ctx.token_preview = []
  ctx.string_escaped = false
  ctx.string_unicode_remaining = 0
  ctx.utf8_remaining = 0
  ctx.utf8_codepoint = 0
  ctx.utf8_expected = 0
}

fn begin_number(ctx : Ctx, ch : Byte) -> Unit {
  ctx.mode = Number
  ctx.token_start = ctx.offset
  ctx.token_preview = [ch]
  ctx.number_state = if ch == b'-' { Sign } else if ch == b'0' { Zero } else { Integer }
}

fn begin_literal(ctx : Ctx, ch : Byte) -> Unit {
  ctx.mode = Literal
  ctx.literal = if ch == b't' { "true" } else if ch == b'f' { "false" } else { "null" }
  ctx.literal_index = 0
  ctx.token_start = ctx.offset
  ctx.token_preview = [ch]
}

fn key_or_value_start(ctx : Ctx) -> (Bool, ParseError?) {
  if ctx.stack.length() > 0 {
    let frame = ctx.stack[ctx.stack.length() - 1]
    if frame.kind == Object && (frame.state == Empty || frame.state == Key) {
      (true, None)
    } else {
      (false, start_value(ctx))
    }
  } else {
    (false, start_value(ctx))
  }
}

fn push_container(ctx : Ctx, kind : ContainerKind, events : Array[Event]) -> ParseError? {
  match start_value(ctx) {
    Some(error) => Some(error)
    None => {
      let next_depth = ctx.depth + 1
      if next_depth > 2000 {
        Some(make_error(ctx, TooDeep, ctx.offset, "嵌套超过 2000 层"))
      } else {
        ctx.depth = next_depth
        ctx.max_depth = if next_depth > ctx.max_depth { next_depth } else { ctx.max_depth }
        ctx.values += 1
        ctx.stack.push({ kind, state: Empty, start: ctx.offset })
        events.push({
          kind: if kind == Object { StartObject } else { StartArray },
          scalar_kind: None,
          start: ctx.offset,
          end: ctx.offset + 1,
          depth: ctx.depth,
          preview: "",
          skipped: false,
        })
        None
      }
    }
  }
}

fn process_string_byte(ctx : Ctx, ch : Byte, events : Array[Event]) -> ParseError? {
  if ctx.string_unicode_remaining > 0 {
    if !is_hex(ch) {
      Some(make_error(ctx, InvalidEscape, ctx.offset, "Unicode 转义需要四位十六进制数字"))
    } else {
      ctx.string_unicode_remaining -= 1
      preview_append(ctx, ch)
      None
    }
  } else if ctx.string_escaped {
    if ch == b'u' {
      ctx.string_unicode_remaining = 4
    } else if !(ch == b'"' || ch == b'\\' || ch == b'/' || ch == b'b' ||
      ch == b'f' || ch == b'n' || ch == b'r' || ch == b't') {
      return Some(make_error(ctx, InvalidEscape, ctx.offset, "字符串转义序列不合法"))
    }
    preview_append(ctx, ch)
    ctx.string_escaped = false
    None
  } else if ch == b'\\' {
    ctx.string_escaped = true
    preview_append(ctx, ch)
    None
  } else if ch == b'"' {
    if ctx.utf8_remaining > 0 {
      return Some(make_error(ctx, InvalidUtf8, ctx.offset, "字符串包含不完整的 UTF-8 字符"))
    }
    if ctx.string_is_key {
      events.push({
        kind: Key,
        scalar_kind: None,
        start: ctx.token_start,
        end: ctx.offset + 1,
        depth: ctx.depth,
        preview: preview_string(ctx),
        skipped: false,
      })
      ctx.stack[ctx.stack.length() - 1].state = Colon
      ctx.mode = Normal
      ctx.token_start = -1
      ctx.token_preview = []
      ctx.string_is_key = false
    } else {
      finish_scalar(ctx, String, ctx.offset + 1, events)
    }
    None
  } else if ch < b' ' {
    Some(make_error(ctx, UnexpectedChar, ctx.offset, "字符串中不能出现裸控制字符"))
  } else if !utf8_accept(ctx, ch) {
    Some(make_error(ctx, InvalidUtf8, ctx.offset, "JSON 文件不是有效的 UTF-8 文本"))
  } else {
    preview_append(ctx, ch)
    None
  }
}

fn process_token_byte(ctx : Ctx, ch : Byte, events : Array[Event]) -> ParseError? {
  if !is_delimiter(ch) {
    if ctx.mode == Literal {
      if !expected_literal(ctx, ch) {
        Some(make_error(ctx, UnexpectedChar, ctx.offset, "字面量不完整"))
      } else {
        ctx.literal_index += 1
        preview_append(ctx, ch)
        if ctx.literal_index >= ctx.literal.length() - 1 {
          let kind = if ctx.literal == "null" { Null } else { Boolean }
          finish_scalar(ctx, kind, ctx.offset + 1, events)
        }
        None
      }
    } else if !advance_number(ctx, ch) {
      Some(make_error(ctx, InvalidNumber, ctx.offset, "数字格式不合法"))
    } else {
      preview_append(ctx, ch)
      None
    }
  } else if ctx.mode == Literal && ctx.literal_index < ctx.literal.length() - 1 {
    Some(make_error(ctx, UnexpectedChar, ctx.offset, "字面量不完整"))
  } else if ctx.mode == Number && !valid_number_state(ctx.number_state) {
    Some(make_error(ctx, InvalidNumber, ctx.token_start, "数字格式不合法"))
  } else {
    let kind = if ctx.mode == Literal {
      if ctx.literal == "null" { Null } else { Boolean }
    } else {
      Number
    }
    finish_scalar(ctx, kind, ctx.offset, events)
    None
  }
}

fn process_normal_byte(ctx : Ctx, ch : Byte, events : Array[Event]) -> ParseError? {
  if ch == b' ' || ch == b'\n' || ch == b'\r' || ch == b'\t' {
    None
  } else if ch == b'"' {
    let (is_key, error) = key_or_value_start(ctx)
    match error {
      Some(error) => Some(error)
      None => {
        begin_string(ctx, is_key)
        None
      }
    }
  } else if ch == b'{' || ch == b'[' {
    let kind = if ch == b'{' { Object } else { Array }
    push_container(ctx, kind, events)
  } else if ch == b']' || ch == b'}' {
    let kind = if ch == b']' { Array } else { Object }
    guard ctx.stack.length() > 0 else {
      return Some(make_error(ctx, ExpectedCommaOrClose, ctx.offset, "括号不匹配或缺少值"))
    }
    let frame = ctx.stack[ctx.stack.length() - 1]
    if frame.kind != kind || (frame.state != Empty && frame.state != Comma) {
      Some(make_error(ctx, ExpectedCommaOrClose, ctx.offset, "括号不匹配或缺少值"))
    } else {
      finish_container(ctx, kind, events)
      None
    }
  } else if ch == b':' {
    guard ctx.stack.length() > 0 else {
      return Some(make_error(ctx, ExpectedColon, ctx.offset, "键名后缺少冒号"))
    }
    let frame = ctx.stack[ctx.stack.length() - 1]
    if frame.kind != Object || frame.state != Colon {
      Some(make_error(ctx, ExpectedColon, ctx.offset, "键名后缺少冒号"))
    } else {
      frame.state = Value
      None
    }
  } else if ch == b',' {
    guard ctx.stack.length() > 0 else {
      return Some(make_error(ctx, ExpectedCommaOrClose, ctx.offset, "逗号位置不正确"))
    }
    let frame = ctx.stack[ctx.stack.length() - 1]
    if frame.state != Comma {
      Some(make_error(ctx, ExpectedCommaOrClose, ctx.offset, "逗号位置不正确"))
    } else {
      frame.state = if frame.kind == Object { Key } else { Value }
      None
    }
  } else if ch == b'-' || is_digit(ch) {
    match start_value(ctx) {
      Some(error) => Some(error)
      None => {
        begin_number(ctx, ch)
        None
      }
    }
  } else if ch == b't' || ch == b'f' || ch == b'n' {
    match start_value(ctx) {
      Some(error) => Some(error)
      None => {
        begin_literal(ctx, ch)
        None
      }
    }
  } else {
    Some(make_error(ctx, UnexpectedChar, ctx.offset, "无法作为 JSON 值的开始"))
  }
}

fn process_byte(ctx : Ctx, ch : Byte, events : Array[Event]) -> ParseError? {
  if ctx.mode == String {
    process_string_byte(ctx, ch, events)
  } else if ctx.mode == Number || ctx.mode == Literal {
    process_token_byte(ctx, ch, events)
  } else {
    process_normal_byte(ctx, ch, events)
  }
}

fn complete(ctx : Ctx) -> Bool {
  ctx.root_done && ctx.stack.length() == 0 && ctx.mode == Normal
}

///| 按 UTF-8 字节增量消费一个窗口；pos/limit 是窗口内边界。
pub fn step_bytes(
  ctx_input : Ctx,
  chunk : Bytes,
  pos : Int,
  limit : Int,
) -> StepResult {
  let ctx = clone_ctx(ctx_input)
  let events : Array[Event] = []
  let start = if pos < 0 { 0 } else { pos }
  let end = if limit < chunk.length() { limit } else { chunk.length() }
  let mut i = start
  while i < end && ctx.error is None {
    let ch = chunk[i]
    let token_mode = ctx.mode == Number || ctx.mode == Literal
    let error = process_byte(ctx, ch, events)
    match error {
      Some(error) => set_error(ctx, error)
      None => {
        // A delimiter terminates a scalar but belongs to the surrounding
        // grammar. Re-run it in Normal mode so `1]` closes the array instead
        // of silently dropping the `]`.
        if token_mode && is_delimiter(ch) && ctx.mode == Normal {
          match process_byte(ctx, ch, events) {
            Some(error) => set_error(ctx, error)
            None => ()
          }
        }
        if ctx.error is None {
          consume_position(ctx, ch)
          i = i + 1
        }
      }
    }
  }
  { next: ctx, events, done: complete(ctx), error: ctx.error }
}

///| 字符串便利入口；内部立即编码为 UTF-8 字节，offset 仍按字节计。
pub fn step(ctx : Ctx, chunk : String, pos : Int, limit : Int) -> StepResult {
  step_bytes(ctx, @utf8.encode(chunk), pos, limit)
}

///| 结束输入，提交最后一个数字/字面量并检查容器完整性。
pub fn finish(ctx_input : Ctx) -> StepResult {
  let ctx = clone_ctx(ctx_input)
  let events : Array[Event] = []
  if ctx.error is Some(_) {
    return { next: ctx, events, done: false, error: ctx.error }
  }
  if ctx.mode == String {
    if ctx.utf8_remaining > 0 {
      let error = make_error(ctx, InvalidUtf8, ctx.offset, "字符串包含不完整的 UTF-8 字符")
      return { next: ctx, events, done: false, error: Some(error) }
    }
    if ctx.string_unicode_remaining > 0 || ctx.string_escaped {
      let error = make_error(ctx, InvalidEscape, ctx.offset, "字符串转义序列不完整")
      return { next: ctx, events, done: false, error: Some(error) }
    }
    let error = make_error(ctx, UnterminatedString, ctx.offset, "字符串没有闭合")
    return { next: ctx, events, done: false, error: Some(error) }
  }
  if ctx.mode == Number {
    if !valid_number_state(ctx.number_state) {
      let error = make_error(ctx, InvalidNumber, ctx.token_start, "数字格式不合法")
      return { next: ctx, events, done: false, error: Some(error) }
    }
    finish_scalar(ctx, Number, ctx.offset, events)
  } else if ctx.mode == Literal {
    if ctx.literal_index != ctx.literal.length() - 1 {
      let error = make_error(ctx, ExpectedValue, ctx.offset, "字面量不完整")
      return { next: ctx, events, done: false, error: Some(error) }
    }
    let kind = if ctx.literal == "null" { Null } else { Boolean }
    finish_scalar(ctx, kind, ctx.offset, events)
  }
  if ctx.stack.length() > 0 || !ctx.root_done {
    let error = make_error(ctx, ExpectedValue, ctx.offset, "输入在 JSON 值完成前结束")
    return { next: ctx, events, done: false, error: Some(error) }
  }
  { next: ctx, events, done: true, error: None }
}

///| 快进到检查点；不产生事件并清理半 token，语义与 TS skipTo 对齐。
pub fn skip_to(ctx_input : Ctx, target : Int) -> Ctx {
  let ctx = clone_ctx(ctx_input)
  if target > ctx.offset {
    ctx.offset = target
    ctx.line = 1
    ctx.column = target + 1
    ctx.mode = Normal
    ctx.token_start = -1
    ctx.token_preview = []
    ctx.literal = ""
    ctx.literal_index = 0
    ctx.string_escaped = false
    ctx.string_unicode_remaining = 0
    ctx.string_is_key = false
    ctx.utf8_remaining = 0
    ctx.utf8_expected = 0
  }
  ctx
}

///| 兼容旧基准：返回事件计数，避免把结果物化为 JSON 值。
pub fn benchmark_step(ctx : Ctx, chunk : String, pos : Int, limit : Int) -> (Ctx, Int) {
  let result = step(ctx, chunk, pos, limit)
  (result.next, result.events.length())
}

///|
test "chunked RFC parser keeps string, unicode and number continuation" {
  let source = @utf8.encode("{\"名字\":\"跨块😀\",\"n\":-12.5e+2}")
  let mut ctx = new_ctx()
  let mut events : Array[Event] = []
  for i = 0; i < source.length(); i = i + 1 {
    let result = step_bytes(ctx, source, i, i + 1)
    assert_true(result.error is None)
    ctx = result.next
    events = events + result.events
  }
  let result = finish(ctx)
  assert_true(result.error is None)
  events = events + result.events
  assert_true(result.done)
  assert_true(events.any(e => e.kind == EventKind::Key && e.preview == "名字"))
  assert_true(events.any(e => e.kind == EventKind::Scalar && e.scalar_kind == Some(ScalarKind::Number)))
  assert_eq(result.next.offset, source.length())
}

///|
test "invalid grammar reports RFC-compatible error classes and line" {
  let result = step(new_ctx(), "{\"a\":1,}", 0, 8)
  assert_true(result.error is Some(_))
  let error = result.error.unwrap()
  assert_true(error.code == ExpectedCommaOrClose)
  let line_result = step(new_ctx(), "{\n\"a\" 1}", 0, 9)
  assert_true(line_result.error is Some(_))
  assert_eq(line_result.error.unwrap().line, 2)
  assert_eq(line_result.error.unwrap().column, 5)
  assert_eq(line_result.error.unwrap().offset, 6)
}

///|
test "nested JSON spectrum emits token-boundary events" {
  let source = "{\"a\":[true,false,null,{\"n\":-0.25e+2}],\"empty\":[]}"
  let mut ctx = new_ctx()
  let mut events : Array[Event] = []
  let bytes = @utf8.encode(source)
  let mut i = 0
  while i < bytes.length() {
    let result = step_bytes(ctx, bytes, i, i + 1)
    assert_true(result.error is None)
    ctx = result.next
    events = events + result.events
    i = i + 1
  }
  let result = finish(ctx)
  assert_true(result.error is None)
  assert_true(result.done)
  events = events + result.events
  assert_true(events.any(e => e.kind == StartObject))
  assert_true(events.any(e => e.kind == StartArray))
  assert_true(events.any(e => e.kind == EndObject))
  assert_true(events.any(e => e.kind == EndArray))
  assert_true(events.any(e => e.kind == Key && e.preview == "a"))
  assert_true(events.any(e => e.kind == Scalar && e.scalar_kind == Some(Boolean)))
  assert_true(events.any(e => e.kind == Scalar && e.scalar_kind == Some(Null)))
  assert_true(events.any(e => e.kind == Scalar && e.scalar_kind == Some(Number)))
  assert_eq(result.next.max_depth, 3)
}

///|
test "exactly 2000 nested containers is accepted" {
  let mut source = ""
  for _ in 0..<2000 {
    source += "["
  }
  source += "0"
  for _ in 0..<2000 {
    source += "]"
  }
  let result = step(new_ctx(), source, 0, source.length())
  assert_true(result.error is None)
  assert_true(result.done)
  assert_eq(result.next.max_depth, 2000)
}

///|
test "torn escape and invalid UTF-8 are rejected at byte offsets" {
  let escaped = @utf8.encode("\"\\u12G4\"")
  let mut ctx = new_ctx()
  let mut escape_error : ParseError? = None
  for i = 0; i < escaped.length(); i = i + 1 {
    let result = step_bytes(ctx, escaped, i, i + 1)
    ctx = result.next
    match result.error {
      Some(error) => {
        escape_error = Some(error)
        break
      }
      None => ()
    }
  }
  assert_true(escape_error is Some(_))
  assert_true(escape_error.unwrap().code == InvalidEscape)
  assert_eq(escape_error.unwrap().offset, 5)

  let invalid : Bytes = Bytes::from_array([b'\"', 0xE0, 0x80, 0x80, b'\"'])
  let invalid_result = step_bytes(new_ctx(), invalid, 0, invalid.length())
  assert_true(invalid_result.error is Some(_))
  assert_true(invalid_result.error.unwrap().code == InvalidUtf8)
}

///|
test "incomplete UTF-8 at end of input is not mislabeled as a string error" {
  let source : Bytes = Bytes::from_array([b'\"', 0xF0, 0x9F, 0x98])
  let parsed = step_bytes(new_ctx(), source, 0, source.length())
  assert_true(parsed.error is None)
  let result = finish(parsed.next)
  assert_true(result.error is Some(_))
  assert_true(result.error.unwrap().code == InvalidUtf8)
}

///|
test "depth limit and giant preview are bounded" {
  let mut source = ""
  for _ in 0..<2001 {
    source += "["
  }
  source += "0"
  for _ in 0..<2001 {
    source += "]"
  }
  let result = step(new_ctx(), source, 0, source.length())
  assert_true(result.error is Some(_))
  assert_true(result.error.unwrap().code == TooDeep)
  let giant = "{\"blob\":\"" + "x".repeat(20_000) + "\"}"
  let parsed = step(new_ctx(), giant, 0, giant.length())
  assert_true(parsed.error is None)
  let mut blob : Event? = None
  for event in parsed.events {
    if event.kind == EventKind::Scalar {
      blob = Some(event)
      break
    }
  }
  assert_true(blob is Some(_))
  assert_eq(blob.unwrap().preview.length(), 120)
  assert_true(blob.unwrap().skipped)
}

///|
test "snapshot and skip preserve independent mutable state" {
  let ctx = step(new_ctx(), "[1,", 0, 3).next
  let copy = snapshot(ctx)
  let resumed = finish(step(copy, "2]", 0, 2).next)
  assert_true(resumed.done)
  assert_eq(copy.offset, 3)
  assert_eq(skip_to(copy, 2048).offset, 2048)
}
