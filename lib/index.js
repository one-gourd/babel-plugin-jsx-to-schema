(function (factory) {
  typeof define === 'function' && define.amd ? define(factory) :
  factory();
}(function () { 'use strict';

  /**
   * babel plugin that can transform react jsx code to json schema
   * @param t
   * @return {{inherits: *, visitor: {JSXElement: visitor.JSXElement}}}
   */
  module.exports = function (_ref) {
    var t = _ref.types;

    var STYLE_VARIABLE_DECLARATOR = null;
    var STYLE_VARIABLE_NAME = '';

    var DEFAULT_OPTS = {
      component: 'component',
      attributes: 'props',
      children: 'children'
    };

    /**
     * find global style or styles variable
     * @param path
     */
    var findStyleVariableDeclarator = function findStyleVariableDeclarator(path) {
      var variableDeclaratorNodes = path.node.body.filter(function (node) {
        return t.isVariableDeclaration(node);
      });
      variableDeclaratorNodes.forEach(function (node) {
        if (!Array.isArray(node.declarations)) {
          return false;
        }
        node.declarations.forEach(function (declarationNode) {
          var variableName = declarationNode.id.name;
          if (t.isVariableDeclarator(declarationNode) && (variableName === 'style' || variableName === 'styles')) {
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
    var findStyleObjectProperty = function findStyleObjectProperty(node) {
      var result = null;
      var styleKey = node.property.name;
      var styleName = node.object.name;
      if (styleName !== STYLE_VARIABLE_NAME) {
        return result;
      }
      var properties = STYLE_VARIABLE_DECLARATOR.init.properties || [];
      properties.forEach(function (styleObjectProperty) {
        if (styleObjectProperty.key.name === styleKey) {
          result = styleObjectProperty.value;
        }
      });
      return result;
    };

    /**
     * transform style of JSXAttribute
     * @param node
     * @return {*}
     */
    var buildStyleObjectExpression = function buildStyleObjectExpression(node) {
      var result = null;
      switch (node.type) {
        case 'MemberExpression':
          {
            // style={styles.a}
            result = findStyleObjectProperty(node);
            break;
          }
        case 'ObjectExpression':
          {
            // style={{...styles.a, ...styles.b}} get first style by default
            (node.properties || []).forEach(function (propertyNode) {
              if (t.isSpreadProperty(propertyNode)) {
                var currentNode = propertyNode.argument;
                if (t.isMemberExpression(currentNode) && !result) {
                  result = findStyleObjectProperty(currentNode);
                }
              }
            });
            break;
          }
        case 'ConditionalExpression':
          {
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
      var name = '';
      switch (node.type) {
        case 'JSXIdentifier':
          {
            // <Comp />
            name = node.name;
            break;
          }
        case 'JSXMemberExpression':
          {
            // <Comp.A.B.C />
            name = getJSXElementName(node.object) + '.' + node.property.name;
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
    var transformJSXAttributeToObjectExpression = function transformJSXAttributeToObjectExpression(nodes) {
      return [t.ObjectExpression(nodes.map(function (node) {
        var name = t.StringLiteral(node.name.name);
        var value = void 0;
        if (!node.value) {
          value = t.BooleanLiteral(true);
        } else if (/JSXExpressionContainer/i.test(node.value.type)) {
          value = node.value.expression;
          if (!t.isStringLiteral(value) && !t.isNumericLiteral(value) && !t.isBooleanLiteral(value)) {
            // some dynamic variable attributes can not be analysed
            // replace with constant string
            var attributeName = name.value;
            switch (attributeName) {
              case 'style':
                {
                  if (STYLE_VARIABLE_DECLARATOR) {
                    var result = buildStyleObjectExpression(value);
                    if (result) {
                      value = result;
                    }
                  }
                  break;
                }
              case 'src':
                {
                  value = t.StringLiteral('https://gw.alicdn.com/tfs/TB11pUKDiLaK1RjSZFxXXamPFXa-400-400.png');
                  break;
                }
              case 'href':
                {
                  value = t.StringLiteral('#path');
                  break;
                }
              default:
                {
                  value = t.StringLiteral('PlaceHolder Text');
                  break;
                }
            }
          }
        } else {
          value = node.value;
        }
        return t.ObjectProperty(name, value);
      }))];
    };

    /**
     * generateAttributeObjectProperty
     * @param attributes
     * @param file
     * @return {*}
     */
    var generateAttributeObjectProperty = function generateAttributeObjectProperty(attributes, file) {
      var attrExpressions = [];
      var spreadAttributes = [];
      var attrObjectPropertyNode = null;

      while (attributes.length) {
        var attr = attributes.shift();
        if (/^JSXSpreadAttribute$/i.test(attr.type)) {
          spreadAttributes.push(attr.argument);
        } else {
          attrExpressions.push(attr);
        }
      }
      if (attrExpressions.length) {
        attrObjectPropertyNode = transformJSXAttributeToObjectExpression(attrExpressions);
      }

      if (spreadAttributes.length) {
        var extendAttr = spreadAttributes;
        if (attrObjectPropertyNode) {
          extendAttr = spreadAttributes.concat(attrObjectPropertyNode);
        }
        if (extendAttr.length > 1) {
          extendAttr.unshift(t.ObjectExpression([]));
        }
        attrObjectPropertyNode = t.callExpression(file.addHelper('extends'), extendAttr);
      } else {
        attrObjectPropertyNode = attrObjectPropertyNode[0];
      }
      return attrObjectPropertyNode;
    };

    /**
     * decorate JSXText accord PI schema spec
     * @param path
     */
    var decorateJSXElementChildren = function decorateJSXElementChildren(path) {
      var children = path.get('children');
      if (Array.isArray(children)) {
        // filter empty JSXText
        children = children.filter(function (child) {
          if (t.isJSXText(child.node)) {
            child.node.value = child.node.value.trim();
            if (child.node.value.replace(/[\r\n]/g, '') === '') {
              return false;
            }
          }
          return true;
        });

        // transform accord to PI render engine rule
        var standardDomElements = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'span', 'a', 'li', 'Button', 'Checkbox', 'Option'];
        var textAttributeName = 'data_text';
        var node = path.node.openingElement;
        var elementName = node.name.name;
        if (standardDomElements.indexOf(elementName) > -1) {
          if (children.length === 1 && t.isJSXText(children[0])) {
            var text = children[0].node.value;
            var attrName = t.JSXIdentifier(textAttributeName);
            var attrValue = t.StringLiteral(text);
            node.attributes.push(t.JSXAttribute(attrName, attrValue));
            children = [];
          } else if (children.length > 1) {
            children.map(function (item) {
              if (t.isJSXText(item)) {
                var _text = item.node.value;
                item.node = t.JSXElement(t.JSXOpeningElement(t.JSXIdentifier('span'), [], false), t.JSXClosingElement(t.JSXIdentifier('span')), [t.JSXText(_text)]);
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
    var traverseJSXElement = function traverseJSXElement(path, state) {
      var options = Object.assign({}, DEFAULT_OPTS, state.opts);

      var node = path.node;
      if (!/JSXElement/.test(node.type)) {
        return node.expression ? node.expression : t.StringLiteral(node.value);
      }

      var attributes = node.openingElement.attributes;
      var children = decorateJSXElementChildren(path);

      var elementNameNode = t.StringLiteral(getJSXElementName(node.openingElement.name));
      var attributesNode = t.NullLiteral();
      if (attributes.length) {
        attributesNode = generateAttributeObjectProperty(attributes, state.file);
      }
      var childrenNode = t.ArrayExpression([]);
      if (children.length) {
        childrenNode = t.ArrayExpression(children.map(function (child) {
          return traverseJSXElement(child, state);
        }));
      }

      return t.ObjectExpression([t.ObjectProperty(t.StringLiteral(options.component), elementNameNode), t.ObjectProperty(t.StringLiteral(options.attributes), attributesNode), t.ObjectProperty(t.StringLiteral(options.children), childrenNode)]);
    };

    return {
      inherits: require('babel-plugin-transform-react-jsx'),
      pre: function pre() {
        this.ROOT_PATH = null;
        this.SCHEMA_NODE = null;
      },
      visitor: {
        Program: function Program(path, state) {
          this.ROOT_PATH = path;
          findStyleVariableDeclarator(path, state);
        },
        JSXElement: function JSXElement(path, state) {
          path.replaceWith(traverseJSXElement(path, state));
        },
        ClassMethod: {
          exit: function exit(path, state) {
            // only select render function code
            if (path.get('key').node.name === 'render') {
              var body = path.get('body').get('body');
              var returnStatement = body.filter(function (node) {
                return t.isReturnStatement(node);
              });
              if (returnStatement.length) {
                this.SCHEMA_NODE = returnStatement[0].get('argument').node;
              }
            }
          }
        }
      },
      post: function post() {
        if (this.SCHEMA_NODE) {
          this.ROOT_PATH.node.body = [this.SCHEMA_NODE];
        }
      }
    };
  };

}));
