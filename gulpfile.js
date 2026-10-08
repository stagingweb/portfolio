const { src, dest, watch, series, parallel } = require("gulp");
const browserSync = require("browser-sync").create();
const sass = require("gulp-sass")(require("sass"));
const cleanCSS = require("gulp-clean-css");
const rename = require("gulp-rename");
const esbuild = require("esbuild");
const fs = require("node:fs");

const isProd = process.env.NODE_ENV === "production";

function js() {
  return esbuild.build({
    entryPoints: ["assets/js/index/script.js"],
    outfile: "assets/main/js/script.min.js",
    bundle: true,
    format: "esm",
    target: ["es2020"],
    minify: true,
    drop: isProd ? ["console"] : [],
    write: false,
  }).then(({ outputFiles }) => {
    // Three.js shader strings include trailing spaces that trip diff checks.
    fs.writeFileSync(
      outputFiles[0].path,
      outputFiles[0].text.replace(/[ \t]+$/gm, "").replace(/^ +(?=\t)/gm, ""),
    );
  });
}

function css() {
  return src("assets/scss/*.scss", { allowEmpty: true })
    .pipe(sass({ outputStyle: "expanded" }).on("error", sass.logError))
    .pipe(dest("assets/main/css"))
    .pipe(cleanCSS({ compatibility: "ie11" }))
    .pipe(rename({ suffix: ".min" }))
    .pipe(dest("assets/main/css"))
    .pipe(browserSync.stream());
}

function serve() {
  browserSync.init({
    server: "./",
    notify: false,
    open: false,
  });

  watch("assets/js/index/script.js", series(js, (done) => {
    browserSync.reload();
    done();
  }));
  watch("assets/scss/**/*.scss", css);
  watch("*.html").on("change", browserSync.reload);
}

exports.default = series(parallel(js, css), serve);
exports.build = series(parallel(js, css));
