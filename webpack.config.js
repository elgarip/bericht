const resolveHere = require("path").resolve.bind(null, __dirname);
const assignDeep = require("assign-deep");
const values = require("object-values");
const webpack = require("webpack");
const ExtractTextPlugin = require("extract-text-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const autoprefixer = require("autoprefixer");
const cssnested = require("postcss-nested");
const cssvariables = require("postcss-css-variables");
const StaticSiteGeneratorPlugin = require("static-site-generator-webpack-plugin");
const ImageminPlugin = require("imagemin-webpack-plugin").default;
const imageminJpegoptim = require("imagemin-jpegoptim");
const fs = require("fs");
const csvParse = require("d3-dsv").csvParse;
const packageJson = require("./package.json");

const env = process.env.env; // development | phantom | test | staging | production
if (
  !/^(development|phantom|test|staging|production|production-test)$/.test(env)
) {
  throw Error(`Unknown env "${env}"`);
}

const loaderEnv = /^(development|phantom)$/.test(env)
  ? "development"
  : "production";

const configEnv = /^(development|phantom|test)$/.test(env) ? env : "production";

// Allow disabling cabinet through the environment. Useful while developing
// the application completely locally.
const disableCabinet = process.env.DISABLE_CABINET !== undefined;

// Public paths for webpack assets
// NOTE: Don't use full URLs for production here – it won't work. Full URLs will be joined together with websiteUrl below where necessary (OpenGraph)
const publicPaths = {
  development: "/",
  phantom: "/",
  test: "/build-test/",
  staging: "/",
  production: "/static/LB/",
  "production-test":
    "/german-federal-government/1616-quality-of-life-in-germany-prod/"
};

// Will be used for generating OpenGraph and sharing URLs
const websiteUrl = "https://www.gut-leben-in-deutschland.de";

const isRouteKey = /^route\/(?!404)/;
const staticRoutes = csvParse(
  fs.readFileSync(resolveHere("content/translations.csv"), "utf8")
)
  .filter(row => isRouteKey.test(row.key))
  .reduce((routes, row) => routes.concat([row.en, row.de]), [])
  .concat("/404.html");

const loaders = {
  common: {
    globalize: {
      test: /globalize/,
      use: { loader: "imports-loader", options: { define: false } }
    },
    js: {
      test: /\.js$/,
      include: [
        resolveHere("src"),
        resolveHere("docs"),
        resolveHere("cabinet")
      ],
      loader: "babel-loader"
    },
    css: {
      test: /\.css$/,
      use: [
        "style-loader",
        {
          loader: "css-loader",
          options: {
            modules: true,
            importLoaders: 1,
            localIdentName: "[name]-[local]-[hash:base64:5]"
          }
        },
        {
          loader: "postcss-loader",
          options: {
            ident: "postcss",
            plugins: () => [
              autoprefixer({ browsers: ["last 2 versions"] }),
              cssnested(),
              cssvariables({
                variables: stringifyValues(require("./src/theme/constants.js"))
              })
            ]
          }
        }
      ]
    },

    // Images
    png: { test: /\.png$/, loader: "url-loader?limit=8192&mimetype=image/png" },
    gif: { test: /\.gif$/, loader: "url-loader?limit=8192&mimetype=image/gif" },
    jpg: { test: /\.jpe?g$/, loader: "file-loader" },
    svgIcon: {
      test: /\.icon\.svg$/,
      include: [resolveHere("src")],
      use: [
        { loader: "svg-react-loader", options: { name: "SvgIcon" } },
        {
          loader: "svgo-loader",
          options: {
            plugins: [
              { removeAttrs: { attrs: "svg:xmlns.*" } },
              {
                cleanupIDs: {
                  remove: true,
                  minify: true,
                  prefix: "svg-react-icon-"
                }
              }
            ]
          }
        }
      ]
    },
    svgChart: {
      test: /\.chart\.svg$/,
      include: [resolveHere("src")],
      use: [
        { loader: "svg-react-loader", options: { name: "SvgChart" } },
        {
          loader: "svgo-loader",
          options: {
            plugins: [
              { removeAttrs: { attrs: ["svg:xmlns.*", "text:font-weight"] } },
              {
                cleanupIDs: {
                  remove: true,
                  minify: true,
                  prefix: "svg-react-chart-"
                }
              },
              { removeDesc: false },
              { removeViewBox: false }
            ]
          }
        }
      ]
    },
    svg: {
      test: /\.svg$/,
      exclude: /\.(icon|chart)\.svg$/,
      loader: "file-loader"
    },

    // Data
    tsv: { test: /\.tsv$/, loader: "dsv-loader?delimiter=\t" },
    csv: { test: /\.csv$/, loader: "dsv-loader" },

    // Fonts
    woff2: {
      test: /\.woff2$/,
      loader: "url-loader?limit=8192&mimetype=application/font-woff2"
    },
    woff: {
      test: /\.woff$/,
      loader: "url-loader?limit=8192&mimetype=application/font-woff"
    },
    ttf: { test: /\.ttf$/, loader: "file-loader" },
    otf: { test: /\.otf$/, loader: "file-loader" },
    eot: { test: /\.eot$/, loader: "file-loader" },

    // Other
    md: { test: /\.md$/, loader: "catalog/loader!raw-loader" }
  },

  development: {},

  production: {
    css: {
      test: /\.css$/,
      use: ExtractTextPlugin.extract({
        fallback: "style-loader",
        use: [
          {
            loader: "css-loader",
            // Disable orderedValues optimization, see https://github.com/webpack/css-loader/issues/316
            options: { orderedValues: false, modules: true, importLoaders: 1, minimize: true }
          },
          {
            loader: "postcss-loader",
            options: {
              ident: "postcss",
              plugins: () => [
                autoprefixer({ browsers: ["last 2 versions"] }),
                cssnested(),
                cssvariables({
                  variables: stringifyValues(
                    require("./src/theme/constants.js")
                  )
                })
              ]
            }
          }
        ]
      })
    }
  }
};

if (typeof loaders[loaderEnv] === "undefined") {
  throw Error(`No webpack loaders for env "${env}"`);
}

// The cssvariables postcss plugin requires that all values are strings. But in
// our JavaScript code we want to have real numbers (React and Aphrodite treat
// margin:65 and margin:'65' /very/ differently).
function stringifyValues(obj) {
  const ret = {};
  Object.keys(obj).forEach(k => {
    ret[k] = "" + obj[k];
  });
  return ret;
}

const webpackConfig = {
  common: {
    output: {
      path: resolveHere("build"),
      publicPath: publicPaths[env]
    },
    resolve: {
      modules: [resolveHere("src"), "node_modules"],
      alias: {
        assets: resolveHere("assets"),
        content: resolveHere("content"),
        cabinet: resolveHere("cabinet"),
        aphrodite: "aphrodite/no-important"
      }
    },
    module: {
      rules: values(Object.assign({}, loaders.common, loaders[loaderEnv]))
    }
  },

  development: {
    entry: {
      app: [
        "babel-polyfill",
        "react-hot-loader/patch",
        "webpack-hot-middleware/client?noInfo=true&reload=true",
        resolveHere("src/index")
      ],
      "dimension-01": [
        "babel-polyfill",
        resolveHere("src/content/dimension-01")
      ],
      "dimension-02": [
        "babel-polyfill",
        resolveHere("src/content/dimension-02")
      ],
      "dimension-03": [
        "babel-polyfill",
        resolveHere("src/content/dimension-03")
      ],
      "dimension-04": [
        "babel-polyfill",
        resolveHere("src/content/dimension-04")
      ],
      "dimension-05": [
        "babel-polyfill",
        resolveHere("src/content/dimension-05")
      ],
      "dimension-06": [
        "babel-polyfill",
        resolveHere("src/content/dimension-06")
      ],
      "dimension-07": [
        "babel-polyfill",
        resolveHere("src/content/dimension-07")
      ],
      "dimension-08": [
        "babel-polyfill",
        resolveHere("src/content/dimension-08")
      ],
      "dimension-09": [
        "babel-polyfill",
        resolveHere("src/content/dimension-09")
      ],
      "dimension-10": [
        "babel-polyfill",
        resolveHere("src/content/dimension-10")
      ],
      "dimension-11": [
        "babel-polyfill",
        resolveHere("src/content/dimension-11")
      ],
      "dimension-12": [
        "babel-polyfill",
        resolveHere("src/content/dimension-12")
      ]
    },
    output: {
      pathinfo: true,
      filename: "[name].js",
      chunkFilename: "[name].chunk.js"
    },
    devtool: "cheap-module-source-map",
    plugins: [
      new webpack.HotModuleReplacementPlugin(),
      new webpack.DefinePlugin({
        __PHANTOM__: JSON.stringify(env === "phantom" ? true : false),
        __DEV__: JSON.stringify(env === "phantom" ? false : true),
        __CABINET_ENABLED__: JSON.stringify(
          disableCabinet || env === "phantom" ? false : true
        ),
        __CATALOG_ENABLED__: JSON.stringify(env === "phantom" ? false : true),
        __WEBSITE_URL__: JSON.stringify(websiteUrl),
        "process.env.NODE_ENV": JSON.stringify("development")
      }),
      new HtmlWebpackPlugin({
        title: packageJson.name,
        template: resolveHere("src/index.html"),
        description: packageJson.description,
        version: packageJson.version,
        chunks: ["common", "app"]
      }),
      new webpack.optimize.CommonsChunkPlugin({
        name: "common"
      })
    ]
  },

  production: {
    entry: {
      static: ["babel-polyfill", resolveHere("src/static")],
      app: ["babel-polyfill", resolveHere("src/index")],
      "dimension-01": [
        "babel-polyfill",
        resolveHere("src/content/dimension-01")
      ],
      "dimension-02": [
        "babel-polyfill",
        resolveHere("src/content/dimension-02")
      ],
      "dimension-03": [
        "babel-polyfill",
        resolveHere("src/content/dimension-03")
      ],
      "dimension-04": [
        "babel-polyfill",
        resolveHere("src/content/dimension-04")
      ],
      "dimension-05": [
        "babel-polyfill",
        resolveHere("src/content/dimension-05")
      ],
      "dimension-06": [
        "babel-polyfill",
        resolveHere("src/content/dimension-06")
      ],
      "dimension-07": [
        "babel-polyfill",
        resolveHere("src/content/dimension-07")
      ],
      "dimension-08": [
        "babel-polyfill",
        resolveHere("src/content/dimension-08")
      ],
      "dimension-09": [
        "babel-polyfill",
        resolveHere("src/content/dimension-09")
      ],
      "dimension-10": [
        "babel-polyfill",
        resolveHere("src/content/dimension-10")
      ],
      "dimension-11": [
        "babel-polyfill",
        resolveHere("src/content/dimension-11")
      ],
      "dimension-12": [
        "babel-polyfill",
        resolveHere("src/content/dimension-12")
      ]
    },
    output: {
      libraryTarget: "umd",
      filename: "[name].[hash].js",
      chunkFilename: "[name].[chunkhash].chunk.js"
    },
    plugins: [
      new webpack.DefinePlugin({
        __PHANTOM__: JSON.stringify(false),
        __DEV__: JSON.stringify(false),
        __CABINET_ENABLED__: JSON.stringify(env === "staging" ? true : false),
        __CATALOG_ENABLED__: JSON.stringify(env === "staging" ? true : false),
        __WEBSITE_URL__: JSON.stringify(websiteUrl),
        "process.env.NODE_ENV": JSON.stringify("production")
      }),
      new ImageminPlugin({
        disable: env === "staging" ? true : false,
        plugins: [
          imageminJpegoptim({
            max: 80
          })
        ]
      }),
      new StaticSiteGeneratorPlugin(
        "static",
        staticRoutes,
        /* locals: */ {},
        /* scope: */ { window: {} }
      ),
      new ExtractTextPlugin("style.[contenthash].css", { allChunks: true }),
      new webpack.optimize.UglifyJsPlugin({
        sourceMap: false,
        compress: {
          warnings: false
        }
      }),
      new webpack.optimize.CommonsChunkPlugin({
        name: "common",
        chunks: [
          "app",
          "dimension-01",
          "dimension-02",
          "dimension-03",
          "dimension-04",
          "dimension-05",
          "dimension-06",
          "dimension-07",
          "dimension-08",
          "dimension-09",
          "dimension-10",
          "dimension-11",
          "dimension-12"
        ]
      })
    ]
  },

  // test is like production but without minification for speed improvements
  test: {
    entry: {
      static: ["babel-polyfill", resolveHere("src/static")],
      app: ["babel-polyfill", resolveHere("src/index")],
      "dimension-01": [
        "babel-polyfill",
        resolveHere("src/content/dimension-01")
      ],
      "dimension-02": [
        "babel-polyfill",
        resolveHere("src/content/dimension-02")
      ],
      "dimension-03": [
        "babel-polyfill",
        resolveHere("src/content/dimension-03")
      ],
      "dimension-04": [
        "babel-polyfill",
        resolveHere("src/content/dimension-04")
      ],
      "dimension-05": [
        "babel-polyfill",
        resolveHere("src/content/dimension-05")
      ],
      "dimension-06": [
        "babel-polyfill",
        resolveHere("src/content/dimension-06")
      ],
      "dimension-07": [
        "babel-polyfill",
        resolveHere("src/content/dimension-07")
      ],
      "dimension-08": [
        "babel-polyfill",
        resolveHere("src/content/dimension-08")
      ],
      "dimension-09": [
        "babel-polyfill",
        resolveHere("src/content/dimension-09")
      ],
      "dimension-10": [
        "babel-polyfill",
        resolveHere("src/content/dimension-10")
      ],
      "dimension-11": [
        "babel-polyfill",
        resolveHere("src/content/dimension-11")
      ],
      "dimension-12": [
        "babel-polyfill",
        resolveHere("src/content/dimension-12")
      ]
    },
    output: {
      path: resolveHere("build-test"),
      libraryTarget: "umd",
      filename: "[name].[hash].js",
      chunkFilename: "[name].[chunkhash].chunk.js"
    },
    plugins: [
      new webpack.DefinePlugin({
        __PHANTOM__: JSON.stringify(false),
        __DEV__: JSON.stringify(false),
        __CABINET_ENABLED__: JSON.stringify(false),
        __CATALOG_ENABLED__: JSON.stringify(false),
        __WEBSITE_URL__: JSON.stringify(websiteUrl),
        "process.env.NODE_ENV": JSON.stringify("production")
      }),
      new ImageminPlugin({ disable: true }),
      new StaticSiteGeneratorPlugin(
        "static",
        staticRoutes,
        /* locals: */ {},
        /* scope: */ { window: {} }
      ),
      new ExtractTextPlugin({
        filename: "style.[contenthash].css",
        allChunks: true
      }),
      new webpack.optimize.CommonsChunkPlugin({
        name: "common",
        chunks: [
          "app",
          "dimension-01",
          "dimension-02",
          "dimension-03",
          "dimension-04",
          "dimension-05",
          "dimension-06",
          "dimension-07",
          "dimension-08",
          "dimension-09",
          "dimension-10",
          "dimension-11",
          "dimension-12"
        ]
      })
    ]
  }
};

webpackConfig.phantom = webpackConfig.development;

if (typeof webpackConfig[configEnv] === "undefined") {
  throw Error(`No webpack config for env "${env} / ${configEnv}"`);
}

module.exports = assignDeep(webpackConfig.common, webpackConfig[configEnv]);
