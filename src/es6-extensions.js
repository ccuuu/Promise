"use strict";

//This file contains the ES6 extensions to the core Promises/A+ API

var Promise = require("./core.js");

module.exports = Promise;

/* Static Functions */

var TRUE = valuePromise(true);
var FALSE = valuePromise(false);
var NULL = valuePromise(null);
var UNDEFINED = valuePromise(undefined);
var ZERO = valuePromise(0);
var EMPTYSTRING = valuePromise("");

function valuePromise(value) {
  var p = new Promise(Promise._noop);
  p._state = 1;
  p._value = value;
  return p;
}
Promise.resolve = function (value) {
  //如果传入的参数本身就为一个promise实例，则直接返回该参数
  if (value instanceof Promise) return value;

  //对于其他情况，可以理解为简单的包装为promise实例，返回返回
  if (value === null) return NULL;
  if (value === undefined) return UNDEFINED;
  if (value === true) return TRUE;
  if (value === false) return FALSE;
  if (value === 0) return ZERO;
  if (value === "") return EMPTYSTRING;

  //对于object，则会将此函数当作创建promise的参数
  if (typeof value === "object" || typeof value === "function") {
    try {
      var then = value.then;
      if (typeof then === "function") {
        return new Promise(then.bind(value));
      }
    } catch (ex) {
      //若在调用过程中发生了错误，则直接返回一个reject的promise实例
      return new Promise(function (resolve, reject) {
        reject(ex);
      });
    }
  }
  return valuePromise(value);
};

//将类数组变为数组的函数
var iterableToArray = function (iterable) {
  if (typeof Array.from === "function") {
    // ES2015+, iterables exist
    iterableToArray = Array.from;
    return Array.from(iterable);
  }

  // ES5, only arrays and array-likes exist
  iterableToArray = function (x) {
    return Array.prototype.slice.call(x);
  };
  return Array.prototype.slice.call(iterable);
};

Promise.all = function (arr) {
  var args = iterableToArray(arr);

  return new Promise(function (resolve, reject) {
    //处理边界情况：若参数为空数组，则直接resolve一个空数组
    if (args.length === 0) return resolve([]);
    var remaining = args.length;

    function res(i, val) {
      //如果当前项为对象或者函数
      if (val && (typeof val === "object" || typeof val === "function")) {
        //如果为一个promise实例
        if (val instanceof Promise && val.then === Promise.prototype.then) {
          //处理在调用all之前就已经执行完毕的几种情况，即_state为1，2，3
          while (val._state === 3) {
            val = val._value;
          }
          if (val._state === 1) return res(i, val._value);
          //如果存在某一项的_state为2，即对应的状态为rejected，则直接调用
          //当前race的promise的reject函数
          if (val._state === 2) reject(val._value);
          val.then(function (val) {
            res(i, val);
          }, reject);
          return;
        } else {
          //如果存在then，则调用new Promise构建一个实例
          var then = val.then;
          if (typeof then === "function") {
            var p = new Promise(then.bind(val));
            p.then(function (val) {
              res(i, val);
            }, reject);
            return;
          }
        }
      }
      //将每一项的返回值都保存在对应的数组下标中
      args[i] = val;
      //如果传入的每一项都执行完成，则调用resolve，并将args当作参数返回
      if (--remaining === 0) {
        resolve(args);
      }
    }
    for (var i = 0; i < args.length; i++) {
      res(i, args[i]);
    }
  });
};

//以下并不是原作者写的，而是我写的。只是感到疑惑，为什么需要如此复杂的再额外写
//处理逻辑，而不复用 Promise.resolve 。或许是当某一项不为pending状态的时候不需
//要添加微任务而是直接调用同步函数获取返回值？这是我唯一能想到的区别...

//如果有人能够理解其中的奥秘欢迎告诉我~
Promise.all = function (arr) {
  const args = iterableToArray(arr);
  const { length } = args;

  return new Promise((resolve, reject) => {
    if (!length) resolve([]);

    let finished = 0;
    let res = Array.from({ length });
    args.forEach((item, i) => {
      Promise.resolve(item).then((value) => {
        res[i] = value;
        if (++finished === length) {
          resolve(res);
        }
      }, reject);
    });
  });
};

//reject静态方法
//返回一个reject包装参数形式的promise实例
Promise.reject = function (value) {
  return new Promise(function (resolve, reject) {
    reject(value);
  });
};

//race：
//通过resolve静态方法包装每一项，只要有其中任意一项resolve或reject，则返回当前
//项的返回值
Promise.race = function (values) {
  return new Promise(function (resolve, reject) {
    iterableToArray(values).forEach(function (value) {
      Promise.resolve(value).then(resolve, reject);
    });
  });
};

/* Prototype Methods */

Promise.prototype["catch"] = function (onRejected) {
  return this.then(null, onRejected);
};
