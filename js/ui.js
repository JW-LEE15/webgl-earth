// ui.js — 조절 패널을 만드는 작은 헬퍼 (외부 UI 라이브러리 없이 DOM 으로 직접 구성)

export class Panel {
  constructor(root) {
    this.root = root;
  }

  section(title) {
    const h = document.createElement('h3');
    h.textContent = title;
    this.root.appendChild(h);
  }

  _row(labelText) {
    const row = document.createElement('label');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = labelText;
    row.appendChild(name);
    this.root.appendChild(row);
    return row;
  }

  /** 슬라이더. onInput(value) 는 처음 한 번 호출되지 않는다(초기값은 호출자가 가지고 있음). */
  slider(label, { min, max, step, value, format = (v) => String(v), onInput }) {
    const row = this._row(label);
    const input = document.createElement('input');
    input.type = 'range';
    Object.assign(input, { min, max, step, value });
    const out = document.createElement('span');
    out.className = 'value';
    out.textContent = format(Number(value));
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = format(v);
      onInput(v);
    });
    row.append(input, out);
    return {
      input,
      set(v) { input.value = v; out.textContent = format(Number(input.value)); },
    };
  }

  /** 선택 상자. options: [{ value, label }] */
  select(label, { options, value, onChange }) {
    const row = this._row(label);
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = String(o.value);
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    sel.value = String(value);
    sel.addEventListener('change', () => onChange(sel.value));
    row.appendChild(sel);
    return sel;
  }

  checkbox(label, { checked, onChange }) {
    const row = this._row(label);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    row.appendChild(cb);
    return cb;
  }

  button(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', onClick);
    this.root.appendChild(b);
    return b;
  }

  /** 읽기 전용 값 표시 줄. 반환된 함수로 텍스트를 갱신한다. */
  readout(label) {
    const row = this._row(label);
    const out = document.createElement('span');
    out.className = 'value wide';
    row.appendChild(out);
    return (text) => { out.textContent = text; };
  }
}
