const { greet } = require('./greet');

module.exports = { greetTwice: (name) => greet(name) + greet(name) };
