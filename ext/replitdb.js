// https://github.com/replit/database-node is src. Modified for raw.

const fetch = require("node-fetch");

class Client {
  /**
   * Initiates Class.
   * @param {String} key Custom database URL
   */
  constructor(key) {
    if (key) this.key = key;
    else this.key = process.env.REPLIT_DB_URL;
  }

  // Native Functions
  /**
   * Gets a key
   * @param {String} key Key
   * @param {boolean} [options.raw=false] Makes it so that we return the raw string value. Default is false.
   */
  async get(key) {
    return await fetch(this.key + "/" + key)
      .then((e) => e.text())
      .then((strValue) => {
        return strValue;
      });
  }

  /**
   * Sets a key
   * @param {String} key Key
   * @param {any} value Value
   */
  async set(key, value) {
    const strValue = value.toString();

    await fetch(this.key, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: encodeURIComponent(key) + "=" + encodeURIComponent(strValue),
    });
  }

  /**
   * Deletes a key
   * @param {String} key Key
   */
  async delete(key) {
    await fetch(this.key + "/" + key, { method: "DELETE" });
    
  }

  /**
   * List key starting with a prefix or list all.
   * @param {String} prefix Filter keys starting with prefix.
   */
  async list(prefix = "") {
    return await fetch(
      this.key + `?encode=true&prefix=${encodeURIComponent(prefix)}`
    )
      .then((r) => r.text())
      .then((t) => {
        if (t.length === 0) {
          return [];
        }
        return t.split("\n").map(decodeURIComponent);
      });
  }

  // Dynamic Functions
  /**
   * Clears the database.
   */
  async empty() {
    const promises = [];
    for (const key of await this.list()) {
      promises.push(this.delete(key));
    }

    await Promise.all(promises);

    
  }

  /**
   * Get all key/value pairs and return as an object
   */
  async getAll() {
    let output = {};
    for (const key of await this.list()) {
      let value = await this.get(key);
      output[key] = value;
    }
    return output;
  }

  /**
   * Sets the entire database through an object.
   * @param {Object} obj The object.
   */
  async setAll(obj) {
    for (const key in obj) {
      let val = obj[key];
      await this.set(key, val);
    }
    
  }

  /**
   * Delete multiple entries by keys
   * @param {Array<string>} args Keys
   */
  async deleteMultiple(...args) {
    const promises = [];

    for (const arg of args) {
      promises.push(this.delete(arg));
    }

    await Promise.all(promises);

    
  }
}


const EventEmitter = require('node:events');
const fs = require('fs');
const path = require('path');

let db = new Client();

let impl = {
  String: {
    decode: async function (get) {
      let content = await get('self');

      return content
    },
    encode: async function (string, set) {
      await set('self', string)
    }
  },
  Number: {
    decode: async function (get) {
      let content = await get('self');

      return Number(content)
    },
    encode: async function (number, set) {
      await set('self', number.toString())
    }
  },
  Boolean: {
    decode: async function (get) {
      let content = await get('self');

      return content === '1';
    },
    encode: async function (bool, set) {
      await set('self', Number(bool))
    }
  },
  Array: {
    decode: async function (get) {
      let length = Number(await get('length'));
      let a = [];

      for (let i = 0; i < length; i++) {
        a.push(await get(i, false))
      }

      return a;
    }, 
    encode: async function (arr, set) {
      await set('length', arr.length, false);

      for (let i = 0; i < arr.length; i++) {
        await set(i, arr[i], false)
      }
    }
  },
  
  Object: {
    decode: async function (get) {
      let keys = await get('keys', false);
      let o = {};

      for (let key of keys) {
        o[key] = await get(key, false)
      }

      return o;
    }, 
    encode: async function (obj, set) {
      let keys = Object.keys(obj);
      await set('keys', keys, false);

      for (let key of keys) {
        await set(key, obj[key], false)
      }
    }
  },
}
function w(obj) {
  let f = obj.call;
  delete obj.call;
  Object.entries(obj).forEach(([key, value])=>{
    f[key] = value;
  })

  return f
}
function chain(c) {
  function escape(i) {
    return i.replaceAll(':', '$FWSLH')
  }
  let myself = w({
    get: function (index) {
      if (index === '') {
        index = '$EMPTY'
      }
      return chain(c+':'+escape(index))
    },
    set: async function (name, value) {
      let nc = c + ':' + escape(name);
      let dataType = value.constructor.name;

      impl[dataType].encode(value, async function (thing, value, raw=true) {
        thing = thing.toString();
        if (thing === 'self') {
          return await db.set(nc, value)
        }
        if (!raw) {
          return await chain(nc).set(thing, value)
        }
        return await db.set(nc+':'+thing, value)
      })

      await db.set(nc+'::type', dataType)
    },
    delete: async function (name) {
      let nc = c+':'+escape(name);
      let marked = await db.list(nc+':');
      if (await db.get(nc) !== '') {
        marked.push(nc)
      }
      for (let mark of marked) {
        await db.delete(mark)
      }
    },
    finish: async function () {
      let dataType = await db.get(c+'::type');
      if (dataType === '') {
        return null
      }

      return impl[dataType].decode(async function (thing, raw=true) {
        thing = thing.toString();
        if (thing === 'self') {
          return await db.get(c)
        }
        if (!raw) {
          return await chain(c).get(thing).finish()
        }
        return await db.get(c+':'+thing)
      })
    },

    call: function query(...args) {
      let space = `$SPACE__${Math.random()*10000000}`
      let query = [];
      args.forEach((a)=>{
        if (typeof a === 'string') {
          a = a.trim().replace(/".*?"/g, function (match) {
            return match.replaceAll(' ', space).slice(1, -1)
          }).split(/\s+/g).map((p)=>p.replaceAll(space, ' '))
          a.forEach(e=>query.push(e))
        } else {
          query.push(a)
        }
      })
      let prop = query[1].split(/./g);
      let last = prop[prop.length-1]
      if (query[0] !== 'GET') {
        prop = prop.slice(0,-1);
      }
      let curr = myself;
      prop.forEach((p)=>{
        curr = curr.get(p)
      })
      if (query[0] === "GET") {
        return curr.finish()
      }
      if (query[0] === 'SET') {
        return curr.set(last, query[2])
      }
      if (query[0] === 'DELETE') {
        return curr.delete(last, query[2])
      }
    }
  });
  return myself
}
let events = new EventEmitter();
let q = chain('');
Object.keys(events.__proto__).forEach((k)=>{
  if (!(k in q)) {
    let p = events[k];
    if (typeof p === 'function') {
      q[k] = function (...args) {
        if (k == 'on' && args[0] === 'init') {
          if (!fs.existsSync(path.join(__dirname, 'installed/replitdb.js.init'))) {
            args[1]()
            fs.writeFileSync(path.join(__dirname, 'installed/replitdb.js.init'), '')
          }
        }
        return events[k].apply(events, args)
      }
    } else {
      q[k] = p;
    }
  }
})
q.reset = async function () {
  for (let item of await db.list()) {
    await db.delete(item)
  }
  events.emit('reset')
  events.emit('init')
}
global.query = q;

/* Promise.all([query.set('a', "Hello"),
query.set('b', 10),
query.set('c', false),
query.set('d', ["hi", 30, true]),
query.set('e', {'str':'hi','num':2,'bool':false})]).then(async function () {
  console.log('a', await query.get('a').finish());
  console.log('b', await query.get('b').finish());
  console.log('c', await query.get('c').finish());
  console.log()
  console.log('d', await query.get('d').finish());
  console.log('d.length', await query.get('d').get('length').finish());
  console.log('d.0', await query.get('d').get('0').finish());
  console.log('d.1', await query.get('d').get('1').finish());
  console.log('d.2', await query.get('d').get('2').finish());
  console.log()
  console.log('e', await query.get('e').finish());
  console.log('e.keys', await query.get('e').get('keys').finish());
  console.log('e.str', await query.get('e').get('str').finish());
  console.log('e.num', await query.get('e').get('num').finish());
  console.log('e.bool', await query.get('e').get('bool').finish());
}) */
