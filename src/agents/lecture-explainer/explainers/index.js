// Explainer registry — maps filter keys to explainer modules.
import * as picture from "./picture.js";
import * as code from "./code.js";
import * as text from "./text.js";
import * as diagram from "./diagram.js";
import * as math from "./math.js";
import * as table from "./table.js";
import * as list from "./list.js";
import * as json from "./json.js";

export const explainers = {
  picture,
  code,
  text,
  diagram,
  math,
  table,
  list,
  json,
};

export default explainers;
