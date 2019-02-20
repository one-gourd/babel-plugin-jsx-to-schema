/**
 * babel plugin that can transform react jsx code to json schema
 * @param t
 * @return {{inherits: *, visitor: {JSXElement: visitor.JSXElement}}}
 */
module.exports = function({ types: t }) {
  let STYLE_VARIABLE_DECLARATOR = null;
  let STYLE_VARIABLE_NAME = '';

  const DEFAULT_OPTS = {
    component: 'component',
    attributes: 'props',
    children: 'children',
  };

  /**
   * find global style or styles variable
   * @param path
   */
  const findStyleVariableDeclarator = path => {
    const variableDeclaratorNodes = path.node.body.filter(node =>
      t.isVariableDeclaration(node)
    );
    variableDeclaratorNodes.forEach(node => {
      if (!Array.isArray(node.declarations)) {
        return false;
      }
      node.declarations.forEach(declarationNode => {
        const variableName = declarationNode.id.name;
        if (
          t.isVariableDeclarator(declarationNode) &&
          (variableName === 'style' || variableName === 'styles')
        ) {
          STYLE_VARIABLE_NAME = variableName;
          STYLE_VARIABLE_DECLARATOR = declarationNode;
        }
      });
    });
  };

  /**
   * find real css data node
   * @param node
   * @return {*}
   */
  const findStyleObjectProperty = node => {
    let result = null;
    const styleKey = node.property.name;
    const styleName = node.object.name;
    if (styleName !== STYLE_VARIABLE_NAME) {
      return result;
    }
    const properties = STYLE_VARIABLE_DECLARATOR.init.properties || [];
    properties.forEach(styleObjectProperty => {
      if (styleObjectProperty.key.name === styleKey) {
        result = styleObjectProperty.value;
      } else {
        // result = t.ObjectExpression([]);
      }
    });
    return result;
  };

  /**
   * transform style of JSXAttribute
   * @param node
   * @return {*}
   */
  const buildStyleObjectExpression = node => {
    let result = null;
    switch (node.type) {
      case 'MemberExpression': {
        // style={styles.a}
        result = findStyleObjectProperty(node);
        break;
      }
      case 'ObjectExpression': {
        // style={{...styles.a, ...styles.b}} get first style by default
        (node.properties || []).forEach(propertyNode => {
          if (t.isSpreadProperty(propertyNode)) {
            let currentNode = propertyNode.argument;
            if (t.isMemberExpression(currentNode) && !result) {
              result = findStyleObjectProperty(currentNode);
            }
          }
        });
        break;
      }
      case 'ConditionalExpression': {
        // style={true ? styles.a : styles.b} get first style by default
        // TODO beizhu more stage as `style.a` maybe a SpreadProperty type
        if (t.isMemberExpression(node.consequent)) {
          result = findStyleObjectProperty(node.consequent);
        }
        break;
      }
      // other stage case ?
    }
    return result;
  };

  function getJSXElementName(node) {
    let name = '';
    switch (node.type) {
      case 'JSXIdentifier': {
        // <Comp />
        name = node.name;
        break;
      }
      case 'JSXMemberExpression': {
        // <Comp.A.B.C />
        name = `${getJSXElementName(node.object)}.${node.property.name}`;
        break;
      }
    }
    return name;
  }

  /**
   * transform JSXAttribute to ObjectExpression
   * @param nodes
   * @return {[*]}
   */
  const transformJSXAttributeToObjectExpression = nodes => {
    return [
      t.ObjectExpression(
        nodes.map(node => {
          let name = t.StringLiteral(node.name.name);
          let value;
          if (!node.value) {
            value = t.BooleanLiteral(true);
          } else if (/JSXExpressionContainer/i.test(node.value.type)) {
            value = node.value.expression;
            if (
              !t.isStringLiteral(value) &&
              !t.isNumericLiteral(value) &&
              !t.isBooleanLiteral(value)
            ) {
              // some dynamic variable attributes can not be analysed
              // replace with constant string
              const attributeName = name.value;
              switch (attributeName) {
                case 'style': {
                  if (STYLE_VARIABLE_DECLARATOR) {
                    let result = buildStyleObjectExpression(value);
                    if (result) {
                      value = result;
                    }
                  }
                  break;
                }
                case 'src': {
                  value = t.StringLiteral(
                    'https://gw.alicdn.com/tfs/TB11pUKDiLaK1RjSZFxXXamPFXa-400-400.png'
                  );
                  break;
                }
                case 'href': {
                  value = t.StringLiteral('#path');
                  break;
                }
                default: {
                  value = t.StringLiteral('PlaceHolder Text');
                  break;
                }
              }
            }
          } else {
            value = node.value;
          }
          return t.ObjectProperty(name, value);
        })
      ),
    ];
  };

  /**
   * generateAttributeObjectProperty
   * @param attributes
   * @param file
   * @return {*}
   */
  const generateAttributeObjectProperty = (attributes, file) => {
    let attrExpressions = [];
    let spreadAttributes = [];
    let attrObjectPropertyNode = null;

    while (attributes.length) {
      let attr = attributes.shift();
      if (/^JSXSpreadAttribute$/i.test(attr.type)) {
        spreadAttributes.push(attr.argument);
      } else {
        attrExpressions.push(attr);
      }
    }
    if (attrExpressions.length) {
      attrObjectPropertyNode = transformJSXAttributeToObjectExpression(
        attrExpressions
      );
    }

    if (spreadAttributes.length) {
      let extendAttr = spreadAttributes;
      if (attrObjectPropertyNode) {
        extendAttr = spreadAttributes.concat(attrObjectPropertyNode);
      }
      if (extendAttr.length > 1) {
        extendAttr.unshift(t.ObjectExpression([]));
      }
      attrObjectPropertyNode = t.callExpression(
        file.addHelper('extends'),
        extendAttr
      );
    } else {
      attrObjectPropertyNode = attrObjectPropertyNode[0];
    }
    return attrObjectPropertyNode;
  };

  /**
   * decorate JSXText accord PI schema spec
   * @param path
   */
  const decorateJSXElementChildren = path => {
    let children = path.get('children');
    if (Array.isArray(children)) {
      // filter empty JSXText
      children = children.filter(child => {
        if (t.isJSXText(child.node)) {
          child.node.value = child.node.value.trim();
          if (child.node.value.replace(/[\r\n]/g, '') === '') {
            return false;
          }
        }
        return true;
      });

      // transform accord to PI render engine rule
      const standardDomElements = [
        'p',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'div',
        'span',
        'a',
        'li',
        'Button',
        'Checkbox',
        'Option',
      ];
      const textAttributeName = 'data_text';
      let node = path.node.openingElement;
      let elementName = node.name.name;
      if (standardDomElements.indexOf(elementName) > -1) {
        if (children.length === 1 && t.isJSXText(children[0])) {
          let text = children[0].node.value;
          let attrName = t.JSXIdentifier(textAttributeName);
          let attrValue = t.StringLiteral(text);
          node.attributes.push(t.JSXAttribute(attrName, attrValue));
          children = [];
        } else if (children.length > 1) {
          children.map(item => {
            if (t.isJSXText(item)) {
              let text = item.node.value;
              item.node = t.JSXElement(
                t.JSXOpeningElement(t.JSXIdentifier('span'), [], false),
                t.JSXClosingElement(t.JSXIdentifier('span')),
                [t.JSXText(text)]
              );
            }
          });
        }
      }
    }
    return children;
  };

  /**
   * transform JSXElement to ObjectExpression
   * @param path
   * @param state
   * @return {*}
   */
  const traverseJSXElement = (path, state) => {
    const options = Object.assign({}, DEFAULT_OPTS, state.opts);

    const node = path.node;
    if (!/JSXElement/.test(node.type)) {
      return node.expression ? node.expression : t.StringLiteral(node.value);
    }

    let attributes = node.openingElement.attributes;
    let children = decorateJSXElementChildren(path);

    let elementNameNode = t.StringLiteral(
      getJSXElementName(node.openingElement.name)
    );
    let attributesNode = t.NullLiteral();
    if (attributes.length) {
      attributesNode = generateAttributeObjectProperty(attributes, state.file);
    }
    let childrenNode = t.ArrayExpression([]);
    if (children.length) {
      childrenNode = t.ArrayExpression(
        children.map(child => traverseJSXElement(child, state))
      );
    }

    return t.ObjectExpression([
      t.ObjectProperty(t.StringLiteral(options.component), elementNameNode),
      t.ObjectProperty(t.StringLiteral(options.attributes), attributesNode),
      t.ObjectProperty(t.StringLiteral(options.children), childrenNode),
    ]);
  };

  return {
    inherits: require('babel-plugin-transform-react-jsx'),
    pre: function() {
      this.ROOT_PATH = null;
      this.SCHEMA_NODE = null;
    },
    visitor: {
      Program: function(path, state) {
        this.ROOT_PATH = path;
        findStyleVariableDeclarator(path, state);
      },
      JSXElement: function(path, state) {
        path.replaceWith(traverseJSXElement(path, state));
      },
      ClassMethod: {
        exit: function(path, state) {
          // only select render function code
          if (path.get('key').node.name === 'render') {
            const body = path.get('body').get('body');
            const returnStatement = body.filter(node =>
              t.isReturnStatement(node)
            );
            if (returnStatement.length) {
              this.SCHEMA_NODE = returnStatement[0].get('argument').node;
            }
          }
        },
      },
    },
    post: function() {
      if (this.SCHEMA_NODE) {
        this.ROOT_PATH.node.body = [this.SCHEMA_NODE];
      }
    },
  };
};
