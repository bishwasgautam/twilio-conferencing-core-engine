module.exports = {
    "env": {
        "commonjs": true,
        "es6": true,
        "browser": true,        
        "node": true,
        "amd": true,
        
    },
    "extends": [
        "eslint:recommended",       
    ],
    "globals": {
        "Atomics": "readonly",
        "SharedArrayBuffer": "readonly"
    },
    "parserOptions": {       
        "ecmaVersion": 11
    },   
    "rules": {
    }
};
