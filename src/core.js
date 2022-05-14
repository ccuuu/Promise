"use strict";
//注意：此处的promise只是

var asap = require("asap/raw");

//src目录下的browser-asap和browser-raw为我从asap库中拷贝过来的

//当前的Promise并不是Node和浏览器的原生实现，是一个第三方库asap实现

//asap 是 as soon as possible 的简称，在 Node 和浏览器环境下，能将回调函数以
//高优先级任务来执行（下一个事件循环之前），即把任务放在微任务队列中执行。

function noop() {}

// States:
//
// 0 - pending
// 1 - fulfilled with _value
// 2 - rejected with _value
// 3 - adopted the state of another promise, _value
//
// once the state is no longer pending (0) it is immutable

// All `_` prefixed properties will be reduced to `_{random number}`
// at build time to obfuscate them and discourage their use.
// We don't use symbols or Object.defineProperty to fully hide them
// because the performance isn't good enough.

// to avoid using try/catch inside critical functions, we
// extract them to here.
var LAST_ERROR = null;
var IS_ERROR = {};

//获取参数的then属性。如果此时参数不为对象，则会返回IS_ERROR
function getThen(obj) {
  try {
    return obj.then;
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

//调用fn
function tryCallOne(fn, a) {
  try {
    return fn(a);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

//调用fn
function tryCallTwo(fn, a, b) {
  try {
    fn(a, b);
  } catch (ex) {
    LAST_ERROR = ex;
    return IS_ERROR;
  }
}

module.exports = Promise;

function Promise(fn) {
  if (typeof this !== "object") {
    throw new TypeError("Promises must be constructed via new");
  }
  if (typeof fn !== "function") {
    throw new TypeError("Promise constructor's argument is not a function");
  }
  //标识着deferred（也就是定义的回调）的数量
  //0对应着无回调
  //1对应着1个回调
  //2对应着多个回调
  this._deferredState = 0;
  //状态。一共有四个：
  //0：pending
  //1：fulfilled
  //2：rejected
  //3：adopted（对应的_value为promise时，则当前promise依赖于_value的状态）
  //其中 adopted并非真实存在的状态。而是为了实现递归查找更方便而自定义的状态。
  //对于真实的Promise，并不存在adopted，其展示出来的状态为依赖项的状态，永远
  //都只会有这三个：pending、fulfilled、rejected
  this._state = 0;
  //_value，也就是reject或resolve传递的参数
  this._value = null;
  //回调，也就是then中的回调参数
  this._deferreds = null;
  if (fn === noop) return;
  //doResolve就是执行fn，并同时向fn传递resolve和reject两个参数
  doResolve(fn, this);
}
Promise._onHandle = null;
Promise._onReject = null;
Promise._noop = noop;

/**
 * Take a potentially misbehaving resolver function and make sure
 * onFulfilled and onRejected are only called once.
 *
 * Makes no guarantees about asynchrony.
 */
function doResolve(fn, promise) {
  var done = false;
  //调用fn，并将resolve和reject的代理函数当作参数传递给fn
  var res = tryCallTwo(
    fn,
    function (value) {
      if (done) return;
      done = true;
      resolve(promise, value);
    },
    function (reason) {
      if (done) return;
      done = true;
      reject(promise, reason);
    }
  );
  //如果调用的时候发生了错误，则tryCallTwo将会返回IS_ERROR
  //此时，需要调用reject将错误信息通过promise抛出
  if (!done && res === IS_ERROR) {
    done = true;
    reject(promise, LAST_ERROR);
  }
}
//Promise的then方法。
Promise.prototype.then = function (onFulfilled, onRejected) {
  //如果this的constructor不为promise，也就是通过call等操作改变了then的this指向
  //则调用safeThen方法
  if (this.constructor !== Promise) {
    return safeThen(this, onFulfilled, onRejected);
  }
  //初始化一个空promise作为返回的默认值
  var res = new Promise(noop);
  //调用handle方法

  //注意：此处调用handle方法并不意味着会真实的添加一个微任务到消息队列
  //对于此步来说，正常情况下都只是将回调添加至_deferreds当中，因为此时的_state一般来说
  //都是0，也就是promise正处于pending状态。

  //而如果是以下这种情况：
  // const promise = new Promise((resolve,reject)=>resolve(null))
  // setTimeout(()=>promise.then(...))
  //也就是添加then方法的时候promise实例已经为rejected或者fulfilled状态了，那么
  //handle才会真实的添加微任务。
  handle(this, new Handler(onFulfilled, onRejected, res));

  //将res返回，也就是之前的new Promise(noop)。
  return res;
};

function safeThen(self, onFulfilled, onRejected) {
  return new self.constructor(function (resolve, reject) {
    var res = new Promise(noop);
    res.then(resolve, reject);
    handle(self, new Handler(onFulfilled, onRejected, res));
  });
}
function handle(self, deferred) {
  //找到第一个_value不为promise的实例
  while (self._state === 3) {
    self = self._value;
  }
  if (Promise._onHandle) {
    Promise._onHandle(self);
  }

  //如果在调用handle的时候_state为0，也就是当前实例为pending状态

  //则将_deferreds根据_deferredState的值
  //来选择如何添加。_deferredState可以理解为添加的_deferreds的数量
  //如果为0，则简单赋值
  //如果为1，则将之前的deferred和本次的deferred组成数组
  //如果为其他，则向数组中push

  //实际上就是处理一下情况：
  // const prom = new Promise((resolve,reject)=>resolve(1))
  // prom.then(...)
  // prom.then(...)
  // prom.then(...)
  //当一次promise微任务执行之前添加多个then
  if (self._state === 0) {
    if (self._deferredState === 0) {
      self._deferredState = 1;
      self._deferreds = deferred;
      return;
    }
    if (self._deferredState === 1) {
      self._deferredState = 2;
      self._deferreds = [self._deferreds, deferred];
      return;
    }
    self._deferreds.push(deferred);
    return;
  }
  //如果_state不为0，那么就会直接执行handleResolved，添加微任务

  //而对于上述_state为0的情况，添加微任务的实际为resolve调用的时候。也就是在resolve函数
  //中的finale函数内调用
  handleResolved(self, deferred);
}

function handleResolved(self, deferred) {
  //asap为第三库，在browser端，其实现原理为mutationObserve，也就是另一个微任务
  asap(function () {
    //判断此时promise实例的状态，如果为1则使用then传递的第一个回调参数
    //否则则使用第二个参数

    //注意：到了这一步，只会存在 1，2两种状态，也就是fulfilled和rejected
    //因为_state为0时，不会执行这一步；而_state为3时，会在handle函数的开头位置
    //将其状态赋值为所依赖的_value不为promise的第一个promise的状态。
    var cb = self._state === 1 ? deferred.onFulfilled : deferred.onRejected;

    //若未定义相应回调，比如fulfilled了，但是then中只定义了第二个参数。
    //则使用resolve或reject处理
    //这样做的好处，就是无论当前次then中是如何处理的，你都可以继续基于
    //这个then返回值做链式操作（因为deferred.promise就是对应的返回的promise实例）
    if (cb === null) {
      if (self._state === 1) {
        resolve(deferred.promise, self._value);
      } else {
        reject(deferred.promise, self._value);
      }
      return;
    }

    //如果cb定义，则将_value当作参数传入给cb，并调用，获取其最新的返回值
    //然后将该返回值当作当前then的返回值promise的resolve值传递，实现链式操作

    //若在此过程中，调用发生了错误，则通过then的返回promise的reject值抛出
    var ret = tryCallOne(cb, self._value);
    if (ret === IS_ERROR) {
      reject(deferred.promise, LAST_ERROR);
    } else {
      resolve(deferred.promise, ret);
    }
  });
}
function resolve(self, newValue) {
  // Promise Resolution Procedure: https://github.com/promises-aplus/promises-spec#the-promise-resolution-procedure
  if (newValue === self) {
    return reject(
      self,
      new TypeError("A promise cannot be resolved with itself.")
    );
  }
  if (
    newValue &&
    (typeof newValue === "object" || typeof newValue === "function")
  ) {
    var then = getThen(newValue);
    if (then === IS_ERROR) {
      return reject(self, LAST_ERROR);
    }
    //如果resolve传入的参数为promise实例，则将当前执行的promise的_state置为3

    //而_state为3的意思，就是当前promise的状态依赖于其他promise (这里其他promise
    //就是指其value)
    if (then === self.then && newValue instanceof Promise) {
      self._state = 3;
      self._value = newValue;
      finale(self);
      return;
      //如果传入resolve的参数为一个对象，且对象中存在then方法，并且该对象不为
      //promise实例，则会将此then方法用初始化的时候传入的参数一样的处理逻辑

      //也就是向该then方法中传入resolve和reject，并调用
    } else if (typeof then === "function") {
      doResolve(then.bind(newValue), self);
      return;
    }
  }
  //将_state置为1，把传递给resolve的参数赋值给_value
  self._state = 1;
  self._value = newValue;
  finale(self);
}

function reject(self, newValue) {
  //reject函数会将_state状态置为2
  self._state = 2;
  //将reject传入参数赋值给promise实例的_value
  self._value = newValue;
  if (Promise._onReject) {
    Promise._onReject(self, newValue);
  }
  //调用finale
  finale(self);
}
function finale(self) {
  //如果实例中存在一个回调，则直接handle调用
  if (self._deferredState === 1) {
    handle(self, self._deferreds);
    //调用结束后清空_deferreds，防止回调重复调用
    self._deferreds = null;
  }
  //如果实例中存在多个回调，则遍历调用handle
  if (self._deferredState === 2) {
    for (var i = 0; i < self._deferreds.length; i++) {
      handle(self, self._deferreds[i]);
    }
    //清空_deferreds
    self._deferreds = null;
  }
}

function Handler(onFulfilled, onRejected, promise) {
  this.onFulfilled = typeof onFulfilled === "function" ? onFulfilled : null;
  this.onRejected = typeof onRejected === "function" ? onRejected : null;
  this.promise = promise;
}
