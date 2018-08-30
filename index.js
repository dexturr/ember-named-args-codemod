'use strict';

const fs = require('fs');
const path = require('path');
const templateRecast = require('ember-template-recast');
const globby = require('globby');
const recast = require('recast');

const THIS_VARIABLES_IN_MODEL = ['model', 'target'];
const THIS_VARIABLES_IN_COMPONENT = ['elementId'];

const readFileAsync = filePath => new Promise((resolve, reject) => {
  fs.readFile(filePath, { encoding: 'UTF-8' }, (err, buffer) => {
    if (err) {
      reject(err);
    }
    resolve(buffer);
  });
});

const fileExistsAsync = filePath => new Promise(resolve =>
  fs.access(filePath, fs.constants.F_OK, err =>
    resolve(!err)
  )
);

const writeFileAsync = (filePath, data) => new Promise((resolve, reject) => fs.writeFile(filePath, data, err => {
  if (err) {
    reject(err);
  }
  resolve(true);
}));

module.exports = class NamedArgsCodeShifter {
  constructor() {
    this.rootDirectory = './test-app/app';
    this.componetsDirectory = `${this.rootDirectory}/components`;
    this.templatesDirectory = `${this.rootDirectory}/templates`;
    this.routeDirectory = `${this.rootDirectory}/routes`;
    this.componentTemplatesDirectory = `${this.rootDirectory}/templates/components`;
    this.componetsDictionairy = {};
    this.propertyDictionairy = {};
    this.routePropertyDictionairy = {};
    this.dryRun = false;
  }

  async findScopedArguments(componentName) {
    const fullPath = path.join(this.componetsDirectory, `${componentName}.js`);
    const exists = await fileExistsAsync(fullPath);
    if (exists) {
      const fileText = await readFileAsync(fullPath);
      const ast = recast.parse(fileText);
      let { propertyDictionairy } = this;
      recast.visit(ast, {
        visitProperty({ value }) {
          if (!propertyDictionairy[componentName]) {
            propertyDictionairy[componentName] = [];
          }
          propertyDictionairy[componentName].push(value.key.name);
          value.key.name = `this.${value.key.name}`;
          return value;
        },
      });
    } else {
      console.warn(`Could not find .js file for ${componentName}`);
    }
  }

  async performTransform(filePath, transformFunction) {
    const exists = await fileExistsAsync(filePath);
    if (exists) {
      const fileText = await readFileAsync(filePath);
      let { code } = templateRecast.transform(fileText, () => transformFunction());
      if (!this.dryRun) {
        await writeFileAsync(filePath, code);
      }
    } else {
      console.log(`Could not find ${filePath}`);
    }
  }

  async replaceArguments(componentName) {
    const namedArguments = this.componetsDictionairy[componentName];
    const scopredArguments = this.propertyDictionairy[componentName] || [];
    console.log(scopredArguments);
    // No sense building a whole AST and traversing it if we don't have any named arguments
    if (namedArguments.length || scopredArguments) {
      const fullPath = path.join(this.templatesDirectory, `components/${componentName}.hbs`);
      await this.performTransform(fullPath, () => ({
        PathExpression(node) {
          const [firstPart] = node.original.split('.');
          const isNamed = namedArguments.includes(firstPart);
          const isScoped = scopredArguments.includes(firstPart);
          const argumentName = node.original;
          const isThisArg = THIS_VARIABLES_IN_COMPONENT
            .map(variable => node.original.startsWith(variable))
            .reduce((accumulator, currentValue) => accumulator || currentValue, false);
          if (isNamed && isScoped) {
            console.log(`Argument name ${argumentName} in component ${componentName} is both an argument and present on the JS file. This needs to be resolved manually.`);
          } else if (isNamed) {
            node.original = `@${argumentName}`;
          } else if (isScoped || isThisArg) {
            node.original = `this.${argumentName}`;
          }
        },
      }));
    }
  }

  async replaceModelInRoute(route) {
    await this.performTransform(route, () => ({
      PathExpression(node) {
        const isThisArg = THIS_VARIABLES_IN_MODEL
          .map(variable => node.original.startsWith(variable))
          .reduce((accumulator, currentValue) => accumulator || currentValue, false);
        if (isThisArg) {
          node.original = `this.${node.original}`;
        }
      },
    }));
  }

  pushToComponentsDictionary(componentName, argumentName) {
    const foundArguments = this.componetsDictionairy[componentName];
    if (!foundArguments) {
      // This MustacheStatement refers to a helper or somehting else, do nothing
      return;
    }

    if (!foundArguments.includes(componentName)) {
      foundArguments.push(argumentName);
    }
  }

  findArgumentsInStatement(node) {
    const mustachePath = node.path.original;
    node.hash.pairs.map(hashPair => this.pushToComponentsDictionary(mustachePath, hashPair.key));
  }

  async findArgumentsInFiles(fullPath) {
    const findArgumentsInStatement = this.findArgumentsInStatement.bind(this);
    const fileText = await readFileAsync(fullPath);
    templateRecast.transform(fileText, () => ({
      MustacheStatement(node) {
        findArgumentsInStatement(node);
      },
      BlockStatement(node) {
        findArgumentsInStatement(node);
      },
    }));
  }

  async processFiles() {
    const componentsJsFilesPromise = globby(`${this.componetsDirectory}/**/*.js`);
    const allTemplatesPromise = globby(`${this.templatesDirectory}/**/*.hbs`);
    const routeTemplatesPromise = globby([`${this.templatesDirectory}/**/*.hbs`, `!${this.componentTemplatesDirectory}/**/*.hbs`]);

    const [componentsJsFiles, allTemplates, routeTemplates] = await Promise.all([componentsJsFilesPromise, allTemplatesPromise, routeTemplatesPromise]);

    const strippedFileNames = componentsJsFiles.map(file => file.split('app/components/')[1].replace('.js', ''));
    this.componetsDictionairy = strippedFileNames.reduce((acc, cur) => {
      acc[cur] = [];
      return acc;
    }, {});
    const resolvedRoutes = routeTemplates.map(routeTemplate => path.resolve(routeTemplate));

    const namedArgsPromises = allTemplates.map(this.findArgumentsInFiles, this);
    const thisArgsPromises = strippedFileNames.map(this.findScopedArguments, this);
    await Promise.all(namedArgsPromises.concat(thisArgsPromises));

    const componentReplacePromised = strippedFileNames.map(this.replaceArguments, this);
    const routeReplacePromised = resolvedRoutes.map(this.replaceModelInRoute, this);
    await Promise.all(componentReplacePromised.concat(routeReplacePromised));
  }
};
