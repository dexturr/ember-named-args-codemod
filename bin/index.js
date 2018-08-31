#!/usr/bin/env node
'use strict';
const program = require('commander');
const pkg = require('../package.json');
const NamedArgsCodeShifter = require('../index');

program
  .version(pkg.version)
  .option(
    '-r, --root <filepath>',
    'path to the Ember project',
    './projects/test-app')
  .option('-d, --dry', 'dry run: no changes are made to files', false)
  .parse(process.argv);

const shifter = new NamedArgsCodeShifter(program.root, program.dry);

shifter.processFiles().then(process.exit);
