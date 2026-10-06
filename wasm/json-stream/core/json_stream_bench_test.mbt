// Phase 3 可复现分块基准：仅测扫描循环，不把结果物化为 JSON 值。

let benchmark_chunk : Int = 2 * 1024 * 1024
let benchmark_source : String = "[" + "0,".repeat(512 * 1024) + "0]"

///|
test "bench chunked scanner 1MB" (it : @bench.T) {
  it.bench(fn() {
    let mut ctx = new_ctx()
    let mut pos = 0
    while pos < benchmark_source.length() {
      let limit = if pos + benchmark_chunk < benchmark_source.length() {
        pos + benchmark_chunk
      } else {
        benchmark_source.length()
      }
      ctx = step(ctx, benchmark_source, pos, limit).next
      pos = limit
    }
    it.keep(ctx.offset)
  })
}
