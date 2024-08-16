#!/usr/bin/env scriptisto

// scriptisto-begin
// script_src: src/main.rs
// build_cmd: "cargo build --release && cp ./target/*musl*/release/script ./target/script"
// target_bin: ./target/script
// docker_build:
//    dockerfile: FROM clux/muslrust
//    src_mount_dir: /volume
//    extra_args: [-v,cargo-cache:/root/.cargo/registry]
// files:
//  - path: Cargo.toml
//    content: |
//     package = { name = "script", version = "0.1.0", edition = "2018"}
//     [dependencies]
//     clap={version="4", features=["derive"]}
//     csv="1.3.0"
//     colored="2.1.0"
//     serde={version="1.0", features=["derive"]}
// scriptisto-end

use clap::Parser;
use std::{error::Error, fs::File, path::Path, io::Write, process::Command};
use colored::Colorize;

#[derive(Debug, Parser)]
#[clap(name = "init", about="Init and scale course crawler.")]
struct Opt {
    #[clap(short, long, default_value = "1")]
    replicas: u32,
    #[clap(short, long, default_value = "courses.csv")]
    courses_file: String,
}

#[derive(Debug, serde::Deserialize)]
struct Course {
    id: u32,
}

impl Course {
    fn from_csv(file_path: &Path) -> Result<Vec<Course>, Box<dyn Error>> {
        let mut rdr = csv::Reader::from_reader(File::open(file_path)?);
        let mut courses = Vec::new();
        for result in rdr.deserialize() {
            let course: Course = result?;
            courses.push(course);
        }
        Ok(courses)
    }
}

fn main() {
    let opt = Opt::parse();

    let courses = match Course::from_csv(Path::new(&opt.courses_file)) {
        Ok(courses) => {
            println!("Loaded {} courses", courses.len().to_string().blue());
            courses
        },
        Err(err) => {
            eprintln!("Error: {}", err);
            std::process::exit(1);
        }
    };

    if opt.replicas != courses.len() as u32 {
        eprintln!("Error: replicas count must be equal to courses count");
        std::process::exit(1);
    }

    println!("Launching course crawler with {} replicas for the recorder service...", opt.replicas.to_string().blue());

    let mut compose = File::create("compose.override.yaml").expect("Failed to create compose.override.yaml");
    writeln!(compose, "services:").expect("Failed to write to compose.override.yaml");

    for (i, course) in courses.iter().enumerate() {
        writeln!(compose, "  video-recorder{}:", i + 1).expect("Unable to write to compose.override.yaml");
        writeln!(compose, "    container_name: video-recorder{}", i + 1).expect("Unable to write to compose.override.yaml");
        writeln!(compose, "    environment:").expect("Unable to write to compose.override.yaml");
        writeln!(compose, "      - EMAIL=${{EMAIL}}").expect("Unable to write to compose.override.yaml");
        writeln!(compose, "      - PASSWORD=${{PASSWORD}}").expect("Unable to write to compose.override.yaml");
        writeln!(compose, "      - VIDEO_TO_RECORD_ID={}", course.id).expect("Unable to write to compose.override.yaml");
        writeln!(compose, "    extends:").expect("Unable to write to compose.override.yaml");
        writeln!(compose, "      service: video-recorder").expect("Unable to write to compose.override.yaml");
        writeln!(compose, "      file: common-services.yaml").expect("Unable to write to compose.override.yaml");
    }

    // Run docker compose commands
    let status = Command::new("sh")
        .arg("-c")
        .arg("docker compose down && docker compose up --build -d")
        .status()
        .expect("Failed to execute docker compose commands");

    if !status.success() {
        eprintln!("Error: Failed to run docker compose commands");
        std::process::exit(1);
    }

    println!("Done!");
}

