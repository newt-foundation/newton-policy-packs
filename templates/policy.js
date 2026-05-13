export function run(/* wasm_args */) {
  // const wasmArgs = JSON.parse(wasm_args);
  //
  // const response = httpFetch({
  //   url: `https://api.example.com/data?param=${wasmArgs.param}`,
  //   method: "GET",
  //   headers: [],
  //   body: null
  // });
  //
  // const body = JSON.parse(
  //   new TextDecoder().decode(new Uint8Array(response.body))
  // );

  return JSON.stringify({
    success: true
  });
}
