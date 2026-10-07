const { src, dest, watch, series, parallel } = require("gulp");
const browserSync = require("browser-sync").create();
const sass = require("gulp-sass")(require("sass"));
const cleanCSS = require("gulp-clean-css");
const uglify = require("gulp-uglify");
const rename = require("gulp-rename");
const replace = require("gulp-replace");

const isProd = process.env.NODE_ENV === "production";

// Version theo thời gian thực: 20261005.153042
function getVersion() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${date}.${time}`;
}

function js() {
  const ver = getVersion(); // tính lại mỗi lần task chạy

  return (
    src("assets/js/index/*.js", { allowEmpty: true })
      // Đổi ?ver= của mọi import từ global.min.js (chạy trước uglify)
      .pipe(replace(/global\.min\.js\?ver=[\w.]+/g, `global.min.js?ver=${ver}`))
      .pipe(uglify({ compress: { drop_console: isProd } }))
      .pipe(rename({ suffix: ".min" }))
      .pipe(dest("assets/main/js"))
      .pipe(browserSync.stream())
  );
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

  watch("assets/js/index/*.js", js);
  watch("assets/scss/**/*.scss", css);
  watch("*.html").on("change", browserSync.reload);
}

exports.default = series(parallel(js, css), serve);
exports.build = series(parallel(js, css));
