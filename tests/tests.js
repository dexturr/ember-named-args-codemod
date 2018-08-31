'use strict';

const NamedArgsCodeShifter = require('../index');

describe('Acceptance Tests', () => {
  it('should read all files in the components direcrtory', done => {
    let shifter = new NamedArgsCodeShifter('./test-app/app', true);
    shifter.processFiles().then(() => done());
  });
});
