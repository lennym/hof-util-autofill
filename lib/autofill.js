'use strict';

const Promise = require('bluebird');
const url = require('url');
const Inputs = require('./inputs');

const debug = require('debug')('hof:util:autofill');

const MAX_LOOPS = 3;

module.exports = (browser) => (target, input, options) => {

  options = options || {};
  options.maxLoops = options.maxLoops || MAX_LOOPS;

  const getValue = Inputs(input);

  let last;
  let count = 0;

  function completeTextField(element, name) {
    const value = getValue(name, 'text');
    debug(`Filling field: ${name} with value: ${value}`);
    return browser
      .elementIdClear(element)
      .elementIdValue(element, value)
      .catch(() => {
        // any error here is *probably* because the field is hidden
        // ignore and hope for the best
      });
  }

  function completeFileField(element, name) {
    const value = getValue(name, 'file');
    if (value) {
      debug(`Uploading file: ${value}`);
      return browser.uploadFile(value)
        .then(response => {
          debug(`Uploaded file: ${value} - remote path ${response.value}`);
          return browser
            .addValue(`input[name="${name}"]`, response.value);
        });
    }
    debug(`No file specified for input ${name} - ignoring`);
  }

  function completeRadio(element, name) {
    const value = getValue(name, 'radio');
    if (!value) {
      return browser.elements(`input[type="radio"][name="${name}"]`)
        .then(radios => {
          debug(`Checking random radio: ${name}`);
          const index = 1 + Math.floor(Math.random() * (radios.value.length - 1));
          return browser.elementIdClick(radios.value[index].ELEMENT);
        });
    }
    return browser.elementIdAttribute(element, 'value')
      .then(val => {
        if (val.value === value) {
          debug(`Checking radio: ${name} with value: ${val.value}`);
          browser.elementIdClick(element);
        }
      });
  }

  function completeCheckbox(element, name) {
    const value = getValue(name, 'checkbox');
    return browser.elementIdAttribute(element, 'value')
      .then(val => {
        return browser.elementIdAttribute(element, 'checked')
          .then((checked) => {
            if (value === null) {
              if (!checked.value) {
                debug(`Leaving checkbox: ${name} blank`);
                return;
              }
              debug(`Unchecking checkbox: ${name}`);
              return browser.elementIdClick(element);
            }
            if (!value && !checked.value) {
              debug(`Checking checkbox: ${name} with value: ${val.value}`);
              return browser.elementIdClick(element);
            } else if (value && value.indexOf(val.value) > -1 && !checked.value) {
              debug(`Checking checkbox: ${name} with value: ${val.value}`);
              return browser.elementIdClick(element);
            } else if (value && value.indexOf(val.value) === -1 && checked.value) {
              debug(`Unchecking checkbox: ${name} with value: ${val.value}`);
              return browser.elementIdClick(element);
            }
            debug(`Ignoring checkbox: ${name} with value: ${val.value} - looking for ${value}`);
          });
      });
  }

  function completeSelectElement(element, name) {
    const value = getValue(name, 'select');
    if (!value) {
      return browser.elementIdElements(element, 'option')
        .then((opts) => {
          const index = 1 + Math.floor(Math.random() * (opts.value.length - 1));
          debug(`Selecting option: ${index} from select box: ${name}`);
          return browser.selectByIndex(`select[name="${name}"]`, index);
        });
    }
    debug(`Selecting options: ${value} from select box: ${name}`);
    return browser.selectByValue(`select[name="${name}"]`, value);
  }

  function completeStep(path) {
    return browser
      .elements('input')
      .then(fields => {
        debug(`Found ${fields.value.length} <input> elements`);
        return Promise.map(fields.value, field => {
          return browser.elementIdAttribute(field.ELEMENT, 'type')
            .then(type => {
              return browser.elementIdAttribute(field.ELEMENT, 'name')
                .then(name => {
                  if (type.value === 'radio') {
                    return completeRadio(field.ELEMENT, name.value);
                  } else if (type.value === 'checkbox') {
                    return completeCheckbox(field.ELEMENT, name.value);
                  } else if (type.value === 'file') {
                    return completeFileField(field.ELEMENT, name.value);
                  } else if (type.value === 'text') {
                    return completeTextField(field.ELEMENT, name.value);
                  }
                  debug(`Ignoring field of type ${type.value}`);
                });
            });
        }, {concurrency: 1});
      })
      .elements('select')
      .then(fields => {
        debug(`Found ${fields.value.length} <select> elements`);
        return Promise.map(fields.value, field => {
          return browser.elementIdAttribute(field.ELEMENT, 'name')
            .then(name => {
              return completeSelectElement(field.ELEMENT, name.value);
            });
        });
      })
      .elements('textarea')
      .then(fields => {
        debug(`Found ${fields.value.length} <textarea> elements`);
        return Promise.map(fields.value, field => {
          return browser.elementIdAttribute(field.ELEMENT, 'name')
            .then(name => {
              return completeTextField(field.ELEMENT, name.value);
            });
        });
      })
      .then(() => {
        if (options.screenshots) {
          const screenshot = require('path').resolve(options.screenshots, 'hof-autofill.pre-submit.png');
          return browser.saveScreenshot(screenshot);
        }
      })
      .then(() => {
        debug('Submitting form');
        return browser.$('input[type="submit"]').click();
      })
      .then(() => {
        return browser.getUrl()
          .then(u => {
            u = url.parse(u);
            debug(`New page is: ${u.path}`);
            if (u.path !== path) {
              debug(`Checking current path ${u.path} against last path ${last}`);
              if (last === u.path) {
                count++;
                debug(`Stuck on path ${u.path} for ${count} iterations`);
                if (count === options.maxLoops) {
                  if (options.screenshots) {
                    const screenshot = require('path').resolve(options.screenshots, 'hof-autofill.debug.png');
                    return browser.saveScreenshot(screenshot)
                      .then(() => {
                        throw new Error(`Progress stuck at ${u.path} - screenshot saved to ${screenshot}`);
                      });
                  }
                  throw new Error(`Progress stuck at ${u.path}`);
                }
              } else {
                count = 0;
              }
              last = u.path;
              return completeStep(path);
            }
            debug(`Arrived at ${path}. Done.`);
          });
      })
      .catch(e => {
        return browser.getText('#content')
          .then(text => {
            debug('PAGE CONTENT >>>>>>');
            debug(text);
            debug('END PAGE CONTENT >>>>>>');
          })
          .catch(() => null)
          .then(() => {
            throw e;
          });
      });
  }

  return completeStep(target);

};
