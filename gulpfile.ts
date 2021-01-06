import * as del from "del"
import * as gulp from "gulp"
import * as newer from "gulp-newer"
import * as nodemon from "gulp-nodemon"
import * as tsc from "gulp-typescript"

// https://gulpjs.com/docs/en/getting-started/async-completion

// Error: read EIOat TTY.onStreamRead (internal/stream_base_commons.js:201:27)
process.once("SIGINT", () => process.exit(0))

const args = process.argv.slice(3)
const script = args.length > 1 && args[0] === "--script" ? args[1] : null

const tsp = tsc.createProject("tsconfig.json", {})
const src = tsp.options.baseUrl
const dest = tsp.options.outDir

gulp.task("clean", () => del([`${dest}/**`, `!${dest}`]))

gulp.task("compile", () =>
  gulp
    .src(`${src}/**/*.ts`, { base: "" })
    .pipe(newer({ dest, ext: ".js" }))
    .pipe(tsp())
    .js.pipe(gulp.dest(dest)),
)

gulp.task("watch", done => {
  gulp.watch(`${src}/**/*.ts`, gulp.task("compile"))
  done()
})

gulp.task("nodemon", done =>
  nodemon({
    script,
    watch: [`${dest}/**/*.js`],
    env: { NODE_ENV: "development" },
  }).once("start", done),
)

if (script !== null) {
  gulp.task("inspect", gulp.series("compile", "nodemon", "watch"))
}
