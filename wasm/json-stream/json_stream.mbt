// Phase 3 classic-wasm ABI adapter.
//
// The parser and its dual-target tests live in ./core, which deliberately has
// no imported linear memory so MoonBit's wasm test runner can execute them.
// This package owns only the shared-memory entry points consumed by JS.

#cfg(target="wasm")
let abi_context : @ref.Ref[@core.Ctx] = @ref.Ref(@core.new_ctx())

#cfg(target="wasm")
extern "wasm" fn load_byte(input_ptr : Int) -> Int =
  #|(func (param i32) (result i32) local.get 0 i32.load8_u)

#cfg(target="wasm")
fn bytes_from_memory(input_ptr : Int, input_len : Int) -> Bytes {
  Bytes::makei(input_len, i => load_byte(input_ptr + i).to_byte())
}

///| Stable ABI version for the JS loader.
#cfg(target="wasm")
pub fn abi_version() -> Int {
  1
}

///| Legacy integer probe retained for host smoke tests.
#cfg(target="wasm")
pub fn abi_step(input_ptr : Int, input_len : Int, ctx_ptr : Int, ctx_len : Int) -> Int {
  if input_ptr < 0 || input_len < 0 || ctx_ptr < 0 || ctx_len < 0 {
    -1
  } else {
    input_len + ctx_len
  }
}

///| Classic wasm ABI: consume a linear-memory pointer and byte length.
#cfg(target="wasm")
#export_name("json_stream_step")
pub fn abi_step_bytes(input_ptr : Int, input_len : Int, pos : Int, limit : Int) -> Int {
  if input_ptr < 0 || input_len < 0 || pos < 0 || limit < pos {
    -1
  } else {
    let chunk = bytes_from_memory(input_ptr, input_len)
    let result = @core.step_bytes(abi_context.val, chunk, pos, limit)
    abi_context.val = result.next
    if result.error is Some(_) { -1 } else { result.events.length() }
  }
}

///| Drop events and fast-forward the module context to a source offset.
#cfg(target="wasm")
#export_name("json_stream_skip_to")
pub fn abi_skip_to(target : Int) -> Int {
  abi_context.val = @core.skip_to(abi_context.val, target)
  abi_context.val.offset
}

///| Return the current source offset as a snapshot token.
#cfg(target="wasm")
#export_name("json_stream_snapshot")
pub fn abi_snapshot() -> Int {
  @core.snapshot(abi_context.val).offset
}

///| Reset the module context before opening another source.
#cfg(target="wasm")
#export_name("json_stream_reset")
pub fn abi_reset() -> Int {
  abi_context.val = @core.new_ctx()
  0
}
