# Third-party notices — SciPlot Studio

SciPlot Studio is an independent project. It is not affiliated with, sponsored by, or endorsed by any software vendor or publisher. All trademarks belong to their respective owners. Palette names such as "NPG-style" only describe a colour style. All data in the bundled examples are simulated.

SciPlot Studio's own code is released under the MIT License (see `LICENSE`). It uses the following open-source components, each under its own license:

| Component | How it is used | License |
|---|---|---|
| [Pyodide](https://pyodide.org) 0.27.2 | Python runtime in the browser, loaded from cdn.jsdelivr.net | [MPL-2.0](https://github.com/pyodide/pyodide/blob/main/LICENSE) |
| CPython (inside Pyodide) | Python interpreter | [PSF License](https://docs.python.org/3/license.html) |
| [matplotlib](https://matplotlib.org) | Figure rendering | [Matplotlib License](https://matplotlib.org/stable/project/license.html) |
| [NumPy](https://numpy.org) | Numerics | [BSD-3-Clause](https://numpy.org/doc/stable/license.html) |
| [SciPy](https://scipy.org) | Fitting, statistics, clustering | [BSD-3-Clause](https://github.com/scipy/scipy/blob/main/LICENSE.txt) |
| [pandas](https://pandas.pydata.org) | Tables | [BSD-3-Clause](https://github.com/pandas-dev/pandas/blob/main/LICENSE) |
| [adjustText](https://github.com/Phlya/adjustText) 1.3.0 | Label placement (wheel bundled in `docs/wheels/`) | [MIT](https://github.com/Phlya/adjustText/blob/master/LICENSE) |
| [SheetJS Community Edition](https://sheetjs.com) 0.18.5 | Reading Excel files, loaded from cdn.jsdelivr.net | [Apache-2.0](https://git.sheetjs.com/sheetjs/sheetjs/src/branch/master/LICENSE) |
| Liberation Sans / Liberation Serif | Fonts bundled in `docs/fonts/` | [SIL OFL 1.1](docs/fonts/LICENSE-Liberation.txt) |

The command-line / desktop version (`sciplot.py`, `app.py`) additionally uses [Streamlit](https://streamlit.io) (Apache-2.0) when installed.
