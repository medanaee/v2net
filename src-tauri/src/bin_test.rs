use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct TestStruct {
    pub a: String,
    pub flow: Option<String>,
}

fn main() {
    let json_str = #"{"a": "hello"}"#;
    let res: Result<TestStruct, _> = serde_json::from_str(json_str);
    println!("{:?}", res);
}
