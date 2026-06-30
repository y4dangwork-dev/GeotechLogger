// Layout constants — mirrors fill_template_renderer.py exactly
export const PW = 612;
export const PH = 792;

export const X = {
  left:  36.0,
  dft:   57.55,
  dm:    79.15,
  sym:   102.9,
  sdesc: 273.55,
  elev:  302.35,
  moist: 335.55,
  dcpt:  433.45,
  gw:    468.0,
  right: 576.0,
};

export const GSUR_Y      = 524.0;
export const GSUR_LINE_Y = 533.28;
export const CONTENT_TOP = 524.0;
export const DATA_BOT    = 113.40;

export const DCPT_X0        = 335.55;
export const DCPT_SCALE_MAX = 50;

export const MAX_PER_PAGE = 52.0 / 3.28084;           // ~15.849 m
const DATA_AREA_H         = CONTENT_TOP - DATA_BOT;   // 410.6 pt
export const PT_PER_M     = DATA_AREA_H / (MAX_PER_PAGE + 1.0 / 3.28084); // ~25.42
export const PT_PER_FT    = PT_PER_M / 3.28084;

export const NARROW_H    = 14.0;
export const HDR_LABEL_X = 54.0;

// Colors [r,g,b] 0-1
export const C_BLACK = [0,     0,     0    ];
export const C_WHITE = [1,     1,     1    ];
export const C_BLUE  = [0,     0,     1    ];
export const C_CBLUE = [0,     0,     0.753];
export const C_RED   = [1,     0,     0    ];
export const C_GRAY  = [0.733, 0.733, 0.733];
