use papol_desktop_lib::data::{DataChange, LocalStore};
use papol_desktop_lib::sync::Coordinator;
use serde_json::{json, Map, Value};
use std::path::Path;
use uuid::Uuid;

#[tokio::main]
async fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.len() != 6 {
        eprintln!("usage: native_sync_harness DATABASE BACKEND TOKEN ACCOUNT_ID PAPER_ID");
        std::process::exit(2);
    }
    let database = &arguments[1];
    let backend = &arguments[2];
    let token = &arguments[3];
    let account_uuid = arguments[4].as_str();
    let paper_uuid = &arguments[5];
    let board_uuid = Uuid::new_v4().to_string();
    let item_uuid = Uuid::new_v4().to_string();
    let clip_uuid = Uuid::new_v4().to_string();
    let clip_bytes = b"native viewer clip bytes";
    let sha256;

    {
        let store = LocalStore::open(Path::new(database)).expect("open local database");
        sha256 = store
            .import_blob(clip_bytes, Some("image/png".into()))
            .expect("import offline clip")
            .sha256;
        store
            .mutate(
                account_uuid,
                vec![
                    DataChange {
                        table: "boards".into(),
                        uuid: board_uuid.clone(),
                        operation: "upsert".into(),
                        values: Map::from_iter([("name".into(), json!("End-to-end offline"))]),
                    },
                    DataChange {
                        table: "board_items".into(),
                        uuid: item_uuid.clone(),
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("board_uuid".into(), json!(board_uuid)),
                            ("kind".into(), json!("comment")),
                            ("content".into(), json!("Survived restart and sync")),
                            ("x".into(), json!(18)),
                            ("y".into(), json!(42)),
                        ]),
                    },
                    DataChange {
                        table: "board_items".into(),
                        uuid: clip_uuid.clone(),
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("board_uuid".into(), json!(board_uuid)),
                            ("kind".into(), json!("image")),
                            ("content".into(), json!("Clipped offline")),
                            ("sha256".into(), json!(sha256)),
                            ("original_filename".into(), json!("paper-clip.png")),
                            ("mime_type".into(), json!("image/png")),
                            ("source_url".into(), json!("https://example.test/paper")),
                            ("source_label".into(), json!("Paper, page 3")),
                            ("staged".into(), json!(true)),
                        ]),
                    },
                ],
            )
            .expect("commit offline mutation");
    }

    let seeded = LocalStore::open(Path::new(database)).expect("reopen local database");
    let before = seeded
        .query(account_uuid, "board", json!({"uuid": board_uuid}))
        .expect("offline board survives restart");
    assert_eq!(
        seeded
            .read_blob(&sha256)
            .expect("offline clip survives restart"),
        clip_bytes,
    );
    let initial_sync = Coordinator::new()
        .expect("create coordinator")
        .synchronize(&seeded, account_uuid, backend, token)
        .await
        .expect("synchronize local database");
    let note_uuid = Uuid::new_v4().to_string();
    let ink_uuid = Uuid::new_v4().to_string();
    let paper_clip_uuid = Uuid::new_v4().to_string();
    let imported_paper_uuid = Uuid::new_v4().to_string();
    let imported_copy_uuid = Uuid::new_v4().to_string();
    seeded
        .mutate(
            account_uuid,
            vec![
                DataChange {
                    table: "comments".into(),
                    uuid: note_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_uuid".into(), json!(paper_uuid)),
                        ("content".into(), json!("Native offline note")),
                        ("page".into(), json!(1)),
                        ("anchor_type".into(), json!("point")),
                        ("anchor".into(), json!(r#"{"x":0.25,"y":0.5}"#)),
                    ]),
                },
                DataChange {
                    table: "ink_strokes".into(),
                    uuid: ink_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_uuid".into(), json!(paper_uuid)),
                        ("page".into(), json!(1)),
                        (
                            "points".into(),
                            json!(r#"[{"x":0.1,"y":0.2},{"x":0.3,"y":0.4}]"#),
                        ),
                        ("color".into(), json!("#b3923d")),
                        ("width".into(), json!(0.004)),
                        ("opacity".into(), json!(0.7)),
                        ("shape".into(), json!("flat")),
                    ]),
                },
                DataChange {
                    table: "paper_clips".into(),
                    uuid: paper_clip_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_uuid".into(), json!(paper_uuid)),
                        ("page".into(), json!(1)),
                        (
                            "source".into(),
                            json!(r#"{"x":0.1,"y":0.1,"w":0.2,"h":0.2}"#),
                        ),
                        (
                            "frame".into(),
                            json!(r#"{"x":0.2,"y":0.2,"w":0.3,"h":0.3}"#),
                        ),
                        ("floating".into(), json!(false)),
                    ]),
                },
            ],
        )
        .expect("commit offline annotations");
    let pdf = seeded
        .import_blob(
            b"%PDF-1.4\nnative offline import\n%%EOF",
            Some("application/pdf".into()),
        )
        .expect("import offline PDF");
    seeded
        .mutate(
            account_uuid,
            vec![
                DataChange {
                    table: "papers".into(),
                    uuid: imported_paper_uuid.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("title".into(), json!("Native imported PDF")),
                        ("doi".into(), Value::Null),
                        ("file_path".into(), json!(format!("{}.pdf", pdf.sha256))),
                        ("sha256".into(), json!(pdf.sha256)),
                    ]),
                },
                DataChange {
                    table: "copies".into(),
                    uuid: imported_copy_uuid,
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_uuid".into(), json!(imported_paper_uuid)),
                        ("summary".into(), json!("Imported entirely offline")),
                    ]),
                },
            ],
        )
        .expect("commit offline PDF graph");
    drop(seeded);

    let reopened =
        LocalStore::open(Path::new(database)).expect("restart after offline annotations");
    let offline_notes = reopened
        .query(account_uuid, "comments", json!({"parent_uuid": paper_uuid}))
        .expect("offline notes survive restart");
    let offline_import = reopened
        .query(account_uuid, "paper", json!({"uuid": imported_paper_uuid}))
        .expect("offline PDF survives restart");
    let sync = Coordinator::new()
        .expect("create restart coordinator")
        .synchronize(&reopened, account_uuid, backend, token)
        .await
        .expect("synchronize annotations");
    let status = reopened
        .query(account_uuid, "sync_status", Value::Object(Map::new()))
        .expect("read sync status");
    println!(
        "{}",
        json!({
            "board_uuid": board_uuid,
            "item_uuid": item_uuid,
            "clip_uuid": clip_uuid,
            "sha256": sha256,
            "note_uuid": note_uuid,
            "ink_uuid": ink_uuid,
            "paper_clip_uuid": paper_clip_uuid,
            "imported_paper_uuid": imported_paper_uuid,
            "imported_pdf_sha256": pdf.sha256,
            "offline_import": offline_import,
            "before": before,
            "offline_notes": offline_notes,
            "initial_sync": initial_sync,
            "sync": sync,
            "status": status,
        })
    );
}
