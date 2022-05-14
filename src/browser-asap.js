"use strict";

// rawAsap provides everything we need except exception management.
var rawAsap = require("./raw");
// RawTasks are recycled to reduce GC churn.
var freeTasks = [];
// We queue errors to ensure they are thrown in right order (FIFO).
// Array-as-queue is good enough here, since we are just dealing with exceptions.
var pendingErrors = [];
var requestErrorThrow = rawAsap.makeRequestCallFromTimer(throwFirstError);

function throwFirstError() {
  if (pendingErrors.length) {
    throw pendingErrors.shift();
  }
}

/**
 * Calls a task as soon as possible after returning, in its own event, with priority
 * over other events like animation, reflow, and repaint. An error thrown from an
 * event will not interrupt, nor even substantially slow down the processing of
 * other events, but will be rather postponed to a lower priority event.
 * @param {{call}} task A callable object, typically a function that takes no
 * arguments.
 */
module.exports = asap;
function asap(task) {
  var rawTask;
  //freeTasks介绍：

  //当消息队列执行之前，或许会添加很多回调至asap中，对于这些回调
  //asap会每一个都其创建一个RawTask的实例，而这些实例的作用就是
  //调用回调函数，并处理错误

  //比如一次同步代码执行的过程中，可能会添加10个回调至asap。那么
  //asap就会新建10个RawTask实例。当这些实例在异步任务中执行完成
  //之时，就会添加至freeTasks中，并且清除当前实例的上一次task回调。

  //这么做的好处就是在不改变回调函数体的同时，对其实现了代理，并且
  //缓存了 "代理器"，也就是rawTask实例，阻止垃圾回收带来的性能消耗
  //当下一次添加回调的时候，会从freeTasks的末尾寻找有无剩余的rawTask
  //实例，若无则新增，若有则复用

  //如果普通的代理模式，如下述：
  //   function fn() {
  //     try {
  //       task.call(Object.create(null));
  //     } catch (e) {}
  //   }
  //那么同样，如果有多个回调需要代理，则会创建多个函数，但是这些函数除了
  //在rawAsap的调用过程中存在引用，调用完毕之后引用会消失。从而当前这些
  //function会变为垃圾对象，导致GC回收。如此反复，一次创建对应一次销毁
  //虽然节省了堆内存的空间，但是会导致不必要的性能消耗。但是如果使用asap的
  //模式，则创建10个，调用结束之后依旧会保留这10个，下一次调用依旧可以使用；
  //如果在某一次多余10个，如15个，则会再重新创建5个，一共存在15个rawTask。
  //对于多次反复的调用asap来说，用少量的空间换取了极大的性能提升
  if (freeTasks.length) {
    rawTask = freeTasks.pop();
  } else {
    rawTask = new RawTask();
  }
  rawTask.task = task;
  rawAsap(rawTask);
}

// We wrap tasks with recyclable task objects.  A task object implements
// `call`, just like a function.
function RawTask() {
  this.task = null;
}

// The sole purpose of wrapping the task is to catch the exception and recycle
// the task object after its single use.
RawTask.prototype.call = function () {
  try {
    this.task.call();
  } catch (error) {
    if (asap.onerror) {
      // This hook exists purely for testing purposes.
      // Its name will be periodically randomized to break any code that
      // depends on its existence.
      asap.onerror(error);
    } else {
      // In a web browser, exceptions are not fatal. However, to avoid
      // slowing down the queue of pending tasks, we rethrow the error in a
      // lower priority turn.
      pendingErrors.push(error);
      requestErrorThrow();
    }
  } finally {
    this.task = null;
    freeTasks[freeTasks.length] = this;
  }
};
