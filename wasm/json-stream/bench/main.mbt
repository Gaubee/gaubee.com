// Phase 3 benchmark helper. Generates bounded chunks so native measurements do
// not require a full JSON source string in memory.

///|
let chunk_size : Int = 2 * 1024 * 1024

///|
fn arg_or(args : Array[String], index : Int, fallback : String) -> String {
  if index < args.length() {
    args[index]
  } else {
    fallback
  }
}

///|
fn parse_size_mb(args : Array[String]) -> Int {
  let parsed = @string.parse_int(arg_or(args, 1, "1")) catch { _ => 1 }
  if parsed > 0 {
    parsed
  } else {
    1
  }
}

///|
fn make_fragment_chunk(bytes : Int, first : Bool, last : Bool) -> Bytes {
  let prefix = if first { "[" } else { "" }
  let suffix = if last { "0] " } else { "" }
  let count = (bytes - prefix.length() - suffix.length()) / 2
  let body = "0,".repeat(count)
  let text = prefix + body + suffix
  @utf8.encode(text)
}

///|
fn make_giant_chunk(bytes : Int, first : Bool, last : Bool) -> Bytes {
  let prefix = if first { "{\"blob\":\"" } else { "" }
  let suffix = if last { "\"}" } else { "" }
  let body_size = bytes - prefix.length() - suffix.length()
  @utf8.encode(prefix + "x".repeat(body_size) + suffix)
}

///|
fn main {
  let args = @env.args()
  let megabytes = parse_size_mb(args)
  let shape = arg_or(args, 2, "fragment")
  let target = megabytes.to_uint64() * 1024UL * 1024UL
  let mut ctx = @core.new_ctx()
  let mut consumed = 0UL
  let mut chunks = 0
  while consumed < target {
    let remaining = target - consumed
    let requested = if remaining < chunk_size.to_uint64() {
      remaining
    } else {
      chunk_size.to_uint64()
    }
    // The first fragment chunk includes `[`. Reserve the three-byte `0] `
    // suffix so the final chunk remains a complete valid tail when the target
    // is an exact multiple of the stream chunk size.
    let size = if shape == "fragment" &&
      consumed == 0UL &&
      requested == chunk_size.to_uint64() {
      (requested - 3UL).to_int()
    } else {
      requested.to_int()
    }
    let last = consumed + size.to_uint64() >= target
    let bytes = if shape == "giant" {
      make_giant_chunk(size, consumed == 0UL, last)
    } else {
      make_fragment_chunk(size, consumed == 0UL, last)
    }
    let result = @core.step_bytes(ctx, bytes, 0, bytes.length())
    if result.error is Some(error) {
      println("error offset=\{error.offset} message=\{error.message}")
      return
    }
    ctx = result.next
    consumed = consumed + bytes.length().to_uint64()
    chunks = chunks + 1
  }
  let finished = @core.finish(ctx)
  if finished.error is Some(error) {
    println("error offset=\{error.offset} message=\{error.message}")
  } else {
    println(
      "bytes=\{consumed} chunks=\{chunks} events=\{finished.events.length()}",
    )
  }
}
