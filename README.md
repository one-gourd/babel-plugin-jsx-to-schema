# babel-plugin-jsx-to-schema

[**Babel 6 Plugin**] transform react jsx code to json schema 

![Image](https://img.alicdn.com/tfs/TB1DXxAH3TqK1RjSZPhXXXfOFXa-1331-827.png)

## Install
```
npm i babel-plugin-jsx-to-schema -S
```

## Usage

```javascript
const path = require('path');
const fs = require('fs');
const babel = require('babel-core');
const jsxToSchemaPlugin = require('babel-plugin-jsx-to-schema');

const code = fs.readFileSync(path.join('./', 'code.js'));

const result = babel.transform(code, {
    plugins: [jsxToSchemaPlugin],
});
```

## Reference `demo` file for details
