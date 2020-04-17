process.env.NODE_ENV = 'production';

import fs from 'fs';
import path from 'path';
import merge from 'lodash.merge';
import webpack from 'webpack';
import nodeExternals from 'webpack-node-externals';

import InjectPlugin, { ENTRY_ORDER } from 'webpack-inject-plugin';

import webpackModules from '../compiler/modules';
import webpackBaseConfig from '../compiler/baseConfig';

import { Bundle } from '../compiler/bundler';
import { cleanup } from '../util';
import { getBundles } from './bundles';
import { getEntrypointsFromStats } from '../compiler/bundler/stats';
import { pagesRoot, allEntrypoints } from '../compiler/entrypoints';
import { buildPathSSR, buildPathClient } from '../compiler';

const productionCompiler = ({ ssr, client }) =>
  webpack([
    merge(
      {
        entry: ssr,
        devtool: false,
        output: {
          path: buildPathSSR,
          libraryTarget: 'commonjs2',
        },
        module: webpackModules(true),
        target: 'node',
        externals: [nodeExternals()],
        plugins: [new webpack.ProgressPlugin()],
      },
      webpackBaseConfig,
    ),
    merge(
      {
        entry: client,
        devtool: false,
        output: {
          path: buildPathClient,
          libraryTarget: 'window' as any,
        },
        module: webpackModules(false),
        optimization: {
          splitChunks: { chunks: 'all' },
          runtimeChunk: 'single',
        },
        resolve: {
          alias: {
            css: false as any,
          },
        },
        plugins: [
          new InjectPlugin(
            () => `require('nicessr/dist/csr/runtime').clientEntrypoint()`,
            {
              entryOrder: ENTRY_ORDER.First,
            },
          ),
          new webpack.ProgressPlugin(),
        ],
      },
      webpackBaseConfig,
    ),
  ]);

async function build() {
  await cleanup();

  const entrypointsSSR = (await allEntrypoints()).reduce(
    (entrypointMap, [page, extension]) => {
      return {
        ...entrypointMap,
        [page]: path.join(pagesRoot, `${page}.${extension}`),
      };
    },
    {},
  );
  const entrypointsClient = { ...entrypointsSSR };
  delete entrypointsClient['/_app'];

  const {
    stats: [ssrStats, clientStats],
  } = await new Promise((resolve, reject) =>
    productionCompiler({
      ssr: entrypointsSSR,
      client: entrypointsClient,
    }).run((err, stats) => {
      console.log(err, stats.toString({ colors: true }));
      if (err) reject(err);
      resolve((stats as any) as { stats: [webpack.Stats, webpack.Stats] });
    }),
  );

  const ssrEntrypoints = getEntrypointsFromStats(ssrStats);
  const clientEntrypoints = getEntrypointsFromStats(clientStats);

  const appContextEntrypoint = ssrEntrypoints.find(
    ([pageName]) => pageName === '/_app',
  )?.[1];

  const [ssrBundles, clientBundles] = getBundles(
    ssrEntrypoints as any,
    clientEntrypoints as any,
  );

  const resultingBundles = new Map<string, Bundle>();
  Array.from(ssrBundles.entries()).forEach(([page, entrypoint]) => {
    resultingBundles.set(page, {
      ssr: entrypoint,
      client: clientBundles.get(page),
      appContext: appContextEntrypoint,
    });
  });

  const buildManifest = Object.fromEntries(
    Array.from(resultingBundles.entries()),
  );
  await new Promise((resolve, reject) =>
    fs.writeFile(
      path.join(process.cwd(), '.nicessr', 'build.manifest.json'),
      JSON.stringify(buildManifest),
      (err) => {
        if (err) reject(err);
        resolve();
      },
    ),
  );

  console.log(
    '✅\tCreated bundle successfully, created build manifest at .nicessr/build.manifest.json\n',
  );
  console.log('📋\tBuilt pages:');
  Object.keys(buildManifest).forEach((page) => console.log(`⚛︎\t${page}`));
  process.exit(0);
}

build();
