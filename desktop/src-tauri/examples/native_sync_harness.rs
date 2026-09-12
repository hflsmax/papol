use papol_desktop_lib::data::{DataChange, LocalStore};
use papol_desktop_lib::sync::Coordinator;
use serde_json::{json, Map, Value};
use std::path::Path;
use uuid::Uuid;

#[tokio::main]
async fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.len() != 7 {
        eprintln!(
            "usage: native_sync_harness DATABASE BACKEND TOKEN ACCOUNT_ID PAPER_ID EDITION_ID"
        );
        std::process::exit(2);
    }
    let database = &arguments[1];
    let backend = &arguments[2];
    let token = &arguments[3];
    let account_id: i64 = arguments[4].parse().expect("account ID is an integer");
    let paper_id = &arguments[5];
    let edition_id = &arguments[6];
    let board_id = Uuid::new_v4().to_string();
    let item_id = Uuid::new_v4().to_string();
    let clip_id = Uuid::new_v4().to_string();
    let clip_bytes = b"native viewer clip bytes";
    let blob_sha256;

    {
        let store = LocalStore::open(Path::new(database)).expect("open local database");
        blob_sha256 = store
            .import_blob(clip_bytes, Some("image/png".into()))
            .expect("import offline clip")
            .sha256;
        store
            .mutate(
                account_id,
                vec![
                    DataChange {
                        table: "boards".into(),
                        id: board_id.clone(),
                        operation: "upsert".into(),
                        values: Map::from_iter([("name".into(), json!("End-to-end offline"))]),
                    },
                    DataChange {
                        table: "board_items".into(),
                        id: item_id.clone(),
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("board_id".into(), json!(board_id)),
                            ("kind".into(), json!("comment")),
                            ("content".into(), json!("Survived restart and sync")),
                            ("x".into(), json!(18)),
                            ("y".into(), json!(42)),
                        ]),
                    },
                    DataChange {
                        table: "board_items".into(),
                        id: clip_id.clone(),
                        operation: "upsert".into(),
                        values: Map::from_iter([
                            ("board_id".into(), json!(board_id)),
                            ("kind".into(), json!("image")),
                            ("content".into(), json!("Clipped offline")),
                            ("blob_sha256".into(), json!(blob_sha256)),
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
        .query(account_id, "board", json!({"id": board_id}))
        .expect("offline board survives restart");
    assert_eq!(
        seeded
            .read_blob(&blob_sha256)
            .expect("offline clip survives restart"),
        clip_bytes,
    );
    let initial_sync = Coordinator::new()
        .expect("create coordinator")
        .synchronize(&seeded, account_id, backend, token)
        .await
        .expect("synchronize local database");
    let note_id = Uuid::new_v4().to_string();
    let ink_id = Uuid::new_v4().to_string();
    let paper_clip_id = Uuid::new_v4().to_string();
    let imported_paper_id = Uuid::new_v4().to_string();
    let imported_edition_id = Uuid::new_v4().to_string();
    let imported_copy_id = Uuid::new_v4().to_string();
    seeded
        .mutate(
            account_id,
            vec![
                DataChange {
                    table: "comments".into(),
                    id: note_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_id".into(), json!(paper_id)),
                        ("edition_id".into(), json!(edition_id)),
                        ("content".into(), json!("Native offline note")),
                        ("page".into(), json!(1)),
                        ("anchor_type".into(), json!("point")),
                        ("anchor".into(), json!(r#"{"x":0.25,"y":0.5}"#)),
                    ]),
                },
                DataChange {
                    table: "ink_strokes".into(),
                    id: ink_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("edition_id".into(), json!(edition_id)),
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
                    id: paper_clip_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("edition_id".into(), json!(edition_id)),
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
            account_id,
            vec![
                DataChange {
                    table: "papers".into(),
                    id: imported_paper_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("title".into(), json!("Native imported PDF")),
                        ("doi".into(), Value::Null),
                    ]),
                },
                DataChange {
                    table: "paper_editions".into(),
                    id: imported_edition_id.clone(),
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_id".into(), json!(imported_paper_id)),
                        ("file_path".into(), json!(format!("{}.pdf", pdf.sha256))),
                        ("sha256".into(), json!(pdf.sha256)),
                    ]),
                },
                DataChange {
                    table: "copies".into(),
                    id: imported_copy_id,
                    operation: "upsert".into(),
                    values: Map::from_iter([
                        ("paper_id".into(), json!(imported_paper_id)),
                        ("edition_id".into(), json!(imported_edition_id)),
                        ("edition_sha256".into(), json!(pdf.sha256)),
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
        .query(account_id, "comments", json!({"parent_id": paper_id}))
        .expect("offline notes survive restart");
    let offline_import = reopened
        .query(account_id, "paper", json!({"id": imported_paper_id}))
        .expect("offline PDF survives restart");
    let sync = Coordinator::new()
        .expect("create restart coordinator")
        .synchronize(&reopened, account_id, backend, token)
        .await
        .expect("synchronize annotations");
    let status = reopened
        .query(account_id, "sync_status", Value::Object(Map::new()))
        .expect("read sync status");
    println!(
        "{}",
        json!({
            "board_id": board_id,
            "item_id": item_id,
            "clip_id": clip_id,
            "blob_sha256": blob_sha256,
            "note_id": note_id,
            "ink_id": ink_id,
            "paper_clip_id": paper_clip_id,
            "imported_paper_id": imported_paper_id,
            "imported_edition_id": imported_edition_id,
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
