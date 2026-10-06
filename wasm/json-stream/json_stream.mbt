// Phase 3 JSON stream scanner.
// The JS bridge owns transport and event serialization; this package owns the
// bounded state transition used by wasm/native tests.

///|
pub enum EventKind {
  StartObject
  EndObject
  StartArray
  EndArray
  Key
  Scalar
} derive(Eq)

///|
pub struct Event {
  kind : EventKind
  start : Int
  end : Int
  depth : Int
  preview : String
} derive(Eq)

///|
pub struct Ctx {
  offset : Int
  depth : Int
  values : Int
  max_depth : Int
  root_done : Bool
  in_string : Bool
  escaped : Bool
  token_start : Int
  token_preview : String
} derive(Eq)

///|
pub fn new_ctx() -> Ctx {
  {
    offset: 0,
    depth: 0,
    values: 0,
    max_depth: 0,
    root_done: false,
    in_string: false,
    escaped: false,
    token_start: 0,
    token_preview: "",
  }
}

///|
fn append_preview(text : String, ch : Char) -> String {
  if text.length() >= 120 {
    text
  } else {
    text + ch.to_string()
  }
}

///|
/// A bounded lexical scan. Full grammar validation lives in the JS fallback;
/// this wasm core deliberately keeps Ctx compact and emits stable token spans.
pub fn step(
  ctx : Ctx,
  chunk : String,
  pos : Int,
  limit : Int,
) -> (Ctx, Array[Event]) {
  let end = if limit < chunk.length() { limit } else { chunk.length() }
  let mut next = ctx
  let events : Array[Event] = []
  let mut i = pos
  while i < end {
    let ch = chunk[i].to_char().unwrap()
    if next.in_string {
      if next.escaped {
        next = {
          ..next,
          escaped: false,
          token_preview: append_preview(next.token_preview, ch),
        }
      } else if ch == '\\' {
        next = {
          ..next,
          escaped: true,
          token_preview: append_preview(next.token_preview, ch),
        }
      } else if ch == '"' {
        events.push({
          kind: if next.token_start < 0 {
            Scalar
          } else {
            Key
          },
          start: next.token_start,
          end: next.offset + 1,
          depth: next.depth,
          preview: next.token_preview,
        })
        next = {
          ..next,
          in_string: false,
          token_preview: "",
          token_start: -1,
          values: next.values + 1,
        }
      } else {
        next = { ..next, token_preview: append_preview(next.token_preview, ch) }
      }
    } else if ch == '"' {
      next = { ..next, in_string: true, token_start: -1, token_preview: "" }
    } else if ch == '{' {
      let depth = next.depth + 1
      events.push({
        kind: StartObject,
        start: next.offset,
        end: next.offset + 1,
        depth,
        preview: "",
      })
      next = {
        ..next,
        depth,
        max_depth: if depth > next.max_depth {
          depth
        } else {
          next.max_depth
        },
        values: next.values + 1,
      }
    } else if ch == '[' {
      let depth = next.depth + 1
      events.push({
        kind: StartArray,
        start: next.offset,
        end: next.offset + 1,
        depth,
        preview: "",
      })
      next = {
        ..next,
        depth,
        max_depth: if depth > next.max_depth {
          depth
        } else {
          next.max_depth
        },
        values: next.values + 1,
      }
    } else if ch == '}' {
      events.push({
        kind: EndObject,
        start: next.offset,
        end: next.offset + 1,
        depth: next.depth,
        preview: "",
      })
      next = {
        ..next,
        depth: if next.depth > 0 {
          next.depth - 1
        } else {
          0
        },
        root_done: next.depth == 1,
      }
    } else if ch == ']' {
      events.push({
        kind: EndArray,
        start: next.offset,
        end: next.offset + 1,
        depth: next.depth,
        preview: "",
      })
      next = {
        ..next,
        depth: if next.depth > 0 {
          next.depth - 1
        } else {
          0
        },
        root_done: next.depth == 1,
      }
    } else if ch != ' ' &&
      ch != '\n' &&
      ch != '\r' &&
      ch != '\t' &&
      ch != ',' &&
      ch != ':' {
      if next.token_start < 0 {
        next = {
          ..next,
          token_start: next.offset,
          token_preview: append_preview("", ch),
          values: next.values + 1,
        }
      } else {
        next = { ..next, token_preview: append_preview(next.token_preview, ch) }
      }
    } else if next.token_start >= 0 {
      events.push({
        kind: Scalar,
        start: next.token_start,
        end: next.offset,
        depth: next.depth + 1,
        preview: next.token_preview,
      })
      next = { ..next, token_start: -1, token_preview: "" }
    }
    next = { ..next, offset: next.offset + 1 }
    i = i + 1
  }
  (next, events)
}

///|
pub fn skip_to(ctx : Ctx, target : Int) -> Ctx {
  if target <= ctx.offset {
    ctx
  } else {
    { ..ctx, offset: target, token_start: -1, token_preview: "" }
  }
}

///|
pub fn snapshot(ctx : Ctx) -> Ctx {
  ctx
}

///|
pub fn resume(ctx : Ctx) -> Ctx {
  ctx
}

///|
test "chunked scanner emits bounded previews" {
  let (ctx, first) = step(new_ctx(), "{\"blob\":\"abcdef\"}", 0, 10)
  let (next, second) = step(ctx, "{\"blob\":\"abcdef\"}", 10, 19)
  assert_true(first.length() > 0)
  assert_true(second.length() > 0)
  assert_eq(next.offset, 17)
  assert_true(next.max_depth == 1)
}

///|
test "skip and resume preserve the compact context" {
  let ctx = skip_to(new_ctx(), 2048)
  assert_eq(resume(snapshot(ctx)).offset, 2048)
}
