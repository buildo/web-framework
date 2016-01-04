import EventEmitter3 from 'eventemitter3';
import t from 'tcomb';
import Avenger from 'avenger';
import debug from 'debug';
import debounce from 'lodash/function/debounce';
// import axios from 'axios';

const log = debug('revenge:App');

export default class App {

  static AUTH_KEY = 'AUTH_KEY';

  constructor({
    queries = {},
    data = {},
    remote,
    batchUpdateDelay = 10
  }) {
    // TODO(gio): app itself is an emitter.. not needed
    // except for manual updates in db using update()
    this.emitter = new EventEmitter3();

    // setup batched update()
    this._updateQueue = [];
    this._update = debounce(() => {
      this.emitter.emit('stateWillChange');
      while (this._updateQueue.length > 0) {
        this._updateQueue.shift()();
      }
      this.emitter.emit('stateDidChange');
    }, batchUpdateDelay);

    this.remote = remote;
    this.allQueries = queries;
    this.avenger = new Avenger(queries, data);
    this.avenger.on('change', this.avChange);
  }

  on(event, listener) {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  update(f) {
    if (process.env.NODE_ENV !== 'production') {
      t.assert(t.Func.is(f), `${this.constructor.name}.update(f) expects a function`);
    }
    this._updateQueue.push(f);
    this._update();
  }

  getCache() {
    return this.avenger.cache.state;
  }

  fetch(routes, state = {}): Promise {
    this.state = state;

    // retrieve all (unique) queries
    const qs = routes.map(route => {
        log(`${route.handler.name} queries: %o %o %o %o`, route, route.handler, route.handler.prototype, route.handler.queries ? route.handler.queries : 'no qs');
        return route.handler.queries;
      })
      .filter(v => v)
      .reduce((ac, qs) => ({  ...ac, ...(
        Object.keys(qs)
          // filter them by current state
          .filter(k => qs[k].filter(this.state))
          .reduce((acc, k) => ({  ...acc, [k]: qs[k] }), {})
      ) }), {});

    // and prepare a proper "set" for avenger
    const queries = Object.keys(qs)
      .map(k => qs[k])
      .map(({ query }) => query).reduce((ac, q) => ({
        ...ac,
        [q]: this.allQueries[q]
      }), {});

    // finally run avenger
    log(`fetching queries: %o, state: %o`, queries, this.state);
    return this.runOrRemote(this.state, queries);
  }

  runOrRemote(state, queries) {
    if (!this.remote) {
      // execute locally
      return this.avenger.run(queries, state);

      // } else {
      // TODO(gio): support remote
      // // emit changes for cached values
      // this.qs.cached();

      // // execute on remote
      // const recipe = this.qs.toRecipe();

      // log(`executing recipe on remote ${this.remote}`, recipe);

      // return axios.post(this.remote, recipe).then(({ data }) => {
      //   this.avenger.patchCache({
      //     queries,
      //     state
      //   }, data);
      //   log('data from remote', data);
      //   return data;
      // }).then(updateWithData);
    }
  }

  runCommand(cmd) {
    // TODO(gio): not supporting `remote` yet
    return this.avenger.runCommand(this.state, cmd);
  }

  avChange = data => {
    this.update(() => {
      this._get = data;
    });
  }

  get() {
    // hack: work around the fact that
    // @listener and @queries are two distinct entities
    // listener update event handler already has access to this data
    return this._get || {};
  }

}
