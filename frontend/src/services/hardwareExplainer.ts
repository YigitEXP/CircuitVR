/**
 * Hardware Explainer for SystemVerilog / Verilog RTL Code Blocks
 * Analyzes RTL syntax to predict synthesized FPGA primitives, multiplexer architectures,
 * clock enable usage, and latch risks.
 * 
 * Complies with strict Engineering Manifesto: ZERO EMOJIS, technical rigor.
 */

export interface HardwareExplainerResult {
  title: string;
  category: string;
  categoryType: 'seq' | 'comb' | 'latch_warn' | 'unroll' | 'dsp';
  summary: string;
  primitives: string[];
  findings: string[];
  recommendations: string[];
  timingImpact: string;
  codeSnippet: string;
}

export function explainRtlHardware(snippet: string, isTr: boolean): HardwareExplainerResult {
  const code = snippet.trim();

  const isSequential = /always_ff|@(posedge|negedge)/i.test(code);
  const isComb = /always_comb|always\s*@\s*\(\s*\*\s*\)|assign\s+/i.test(code);
  const hasReset = /rst|reset/i.test(code);
  const hasAsyncReset = /@(posedge\s+\w+\s+or\s+negedge\s+\w+)|@(negedge\s+\w+\s+or\s+posedge\s+\w+)/i.test(code);
  const hasClockEnable = /if\s*\(\s*(en|enable|valid|vld|tvalid|ready|load)/i.test(code);
  const hasMultiplier = /[\w\]\)]\s*\*\s*[\w\(\[]/.test(code);
  const hasAdder = /[\w\]\)]\s*[\+\-]\s*[\w\(\[]/.test(code);
  const hasComparator = /[\w\]\)]\s*(===?|!==?|<=|>=|<|>)\s*[\w\(\[]/.test(code);
  const hasCase = /\bcase\b/i.test(code);
  const hasDefault = /\bdefault\s*:/i.test(code);
  const hasForLoop = /\bfor\s*\(/i.test(code);
  const hasArrayIndexing = /\[\s*[a-zA-Z_]\w*\s*\]\s*<=/i.test(code);
  const hasIfWithoutElse = /\bif\s*\([^\)]+\)\s*begin[\s\S]*?end(?!\s*else)/i.test(code);

  const primitives: string[] = [];
  const findings: string[] = [];
  const recommendations: string[] = [];

  let title = isTr ? 'RTL Sentez Analizi' : 'RTL Synthesis Analysis';
  let category = isTr ? 'Kombinasyonel Mantık' : 'Combinational Logic';
  let categoryType: HardwareExplainerResult['categoryType'] = 'comb';
  let timingImpact = isTr ? 'Düşük yayılım gecikmesi (1-2 LUT seviyesi).' : 'Low propagation delay (1-2 LUT levels).';

  if (isSequential) {
    category = isTr ? 'Ardışıl Mantık (Sequential Logic)' : 'Sequential Logic';
    categoryType = 'seq';
    title = isTr ? 'Yazmaç & Flip-Flop Bloğu' : 'Register & Flip-Flop Block';

    if (hasAsyncReset) {
      primitives.push('FDCE / FDPE (Asynchronous Clear/Preset D-FF)');
      findings.push(
        isTr
          ? 'Asenkron Reset tespit edildi. Flip-Flop doğrudan sıfırlama/kurma pinine bağlanır.'
          : 'Asynchronous reset detected. Connected directly to Flip-Flop CLR/PRE pin.'
      );
      recommendations.push(
        isTr
          ? 'Öneri: Modern FPGA mimarilerinde (UltraScale, Agilex) BRAM/DSP iç boru hattı yazmaçlarına gömülebilmesi için senkron reset tercih edilir.'
          : 'Recommendation: Synchronous reset is preferred on modern FPGAs for DSP/BRAM internal pipeline register retiming.'
      );
    } else if (hasReset) {
      primitives.push('FDRE (Synchronous Reset & Clock Enable D-FF)');
      findings.push(
        isTr
          ? 'Senkron Reset tespit edildi. Saat darbesiyle eşzamanlı sıfırlama, yüksek Fmax ve kontrol seti optimizasyonu sağlar.'
          : 'Synchronous reset detected. Synchronous clearing provides optimal control set sharing and high Fmax.'
      );
    } else {
      primitives.push('FDRE / FDSE');
      findings.push(
        isTr
          ? 'Saf veri saklama yazmacı tespit edildi (Reset hattı yok veya varsayılan değer atanmamış).'
          : 'Pure data storage register inferred without explicit reset condition.'
      );
    }

    if (hasClockEnable) {
      primitives.push('CE Pin (Dedicated Clock Enable)');
      findings.push(
        isTr
          ? 'Koşullu Clock Enable (CE) tespit edildi. Saat ağını boğmadan dinamik güç tüketimi optimize edilir.'
          : 'Clock Enable condition detected. Routes to dedicated FF CE pin, reducing clock network switching power.'
      );
    }

    if (hasForLoop || hasArrayIndexing) {
      primitives.push('Shift Register / SRL16E / SRL32E');
      findings.push(
        isTr
          ? 'Döngülü kaydırma yazmacı (Shift Register) yapısı tespit edildi. Ara port çıkışı yoksa LUTRAM SRL32E olarak tek LUT içine sıkıştırılabilir.'
          : 'Cascaded shift register structure detected. May infer into compact SRL32E LUTRAM if intermediate taps are unread.'
      );
    }

    timingImpact = isTr
      ? 'Kurulum (Setup) ve Tutma (Hold) zamanı kısıtlamalarına tabidir. Saat döngü kısıtlaması (T_clk >= T_co + T_comb + T_setup).'
      : 'Subject to Setup and Hold timing constraints. Cycle timing constraint (T_clk >= T_co + T_comb + T_setup).';
  } else if (hasIfWithoutElse && isComb && !hasDefault) {
    categoryType = 'latch_warn';
    category = isTr ? 'UYARI: İstenmeyen Latch (Memory Latch)' : 'WARNING: Unintended Latch Inferred';
    title = isTr ? 'Eksik Atama & Latch Uyarısı' : 'Missing Assignment & Latch Risk';
    primitives.push('LDCE / LDPE (Level-Sensitive Latch)');
    findings.push(
      isTr
        ? 'always_comb veya combinational blok içinde tüm olasılıklar (else dalı) kapsanmamış. Donanım eski değeri saklamak için Latch üretir.'
        : 'Incomplete branch coverage without else branch. Hardware will infer a level-sensitive latch to preserve state.'
    );
    recommendations.push(
      isTr
        ? 'DÜZELTME: always_comb bloğunun en başına varsayılan değerleri atayın veya tüm if dallarına eksiksiz else ekleyin.'
        : 'FIX: Assign default values at the top of the always_comb block, or add exhaustive else branches.'
    );
    timingImpact = isTr
      ? 'KRİTİK RİSK: Statik zamanlama analizi (STA) hataları, glik/parazit tetiklenmesi ve saat senkronizasyonu kaybı.'
      : 'CRITICAL RISK: Static timing analysis violations, race conditions, and glitch sensitivity.';
  } else {
    // Combinational logic
    if (hasCase) {
      if (hasDefault) {
        primitives.push('Parallel MUX (MUXF7 / MUXF8 / LUT6)');
        findings.push(
          isTr
            ? 'Eksiksiz case bloğu: Paralel Çoklayıcı (Parallel Multiplexer) sentezlenir. Tüm durumlar simetrik gecikmeyle taranır.'
            : 'Complete case block: Parallel Multiplexer synthesized. Symmetric propagation delay across branches.'
        );
      } else {
        primitives.push('Priority MUX / Incomplete MUX');
        findings.push(
          isTr
            ? 'Varsayılan (default) durumu olmayan case: Durum dışı değerlerde belirsizlik veya öncelikli çözücü oluşturabilir.'
            : 'Case without default branch: May synthesize into priority decoding chain or incomplete MUX.'
        );
      }
    }

    if (hasMultiplier) {
      categoryType = 'dsp';
      primitives.push('DSP48E1 / DSP48E2 / DSP58 Slice');
      findings.push(
        isTr
          ? 'Çarpma işlemi (*) tespit edildi. Doğrudan donanımsal gömülü DSP bloklarına eşlenir (Boru hattı yazmaçları eklenirse 700+ MHz Fmax).'
          : 'Multiplier operator (*) detected. Maps directly to hardened DSP slices.'
      );
      recommendations.push(
        isTr
          ? 'Tavsiye: Çarpma sonucunun hemen çıkışına yazmaç (register) ekleyerek DSP dahili boru hattı (pipelining) aktif edilmelidir.'
          : 'Recommendation: Register the product output to leverage internal DSP pipeline stages for maximum Fmax.'
      );
      timingImpact = isTr
        ? 'Boru hattı olmadan kombinasyonel DSP gecikmesi ~2.5 - 4.0 ns civarındadır.'
        : 'Unpipelined DSP combinational delay spans ~2.5 - 4.0 ns.';
    }

    if (hasAdder || hasComparator) {
      primitives.push('CARRY4 / CARRY8 Fast Carry Chains');
      primitives.push('LUT6 (Look-Up Table)');
      findings.push(
        isTr
          ? 'Toplama, çıkarma veya karşılaştırıcı işlemi tespit edildi. Hızlı taşıma zincirleri (CARRY8) ve LUT XOR kapıları kullanılır.'
          : 'Adder/subtractor or comparator detected. Utilizes fast dedicated silicon carry chains (CARRY8) and LUT logic.'
      );
    }
  }

  if (hasForLoop) {
    categoryType = 'unroll';
    primitives.push('Loop Unrolled Silicon Replicas');
    findings.push(
      isTr
        ? 'Döngü Açma (Loop Unrolling): FPGA mimarisinde döngüler zamana yayılmaz; donanım fiziksel olarak silisyum üzerinde N paralel kopya halinde üretilir.'
        : 'Loop Unrolling: Loops do not iterate over clock cycles in silicon; hardware is fully unrolled into parallel physical slices.'
    );
    recommendations.push(
      isTr
        ? 'Büyük döngü sınırları aşırı LUT ve Routing tüketimine yol açabilir. Kaynak kısıtlıysa döngüyü saat darbelerine bölen FSM tasarlayın.'
        : 'Large iteration counts consume substantial LUT resources. For area-constrained designs, serialize across clock cycles with an FSM.'
    );
  }

  if (primitives.length === 0) {
    primitives.push('LUT6 / Distributed Logic');
    findings.push(
      isTr
        ? 'Genel kombinasyonel mantık (Lookup Table - LUT tabanlı Boole fonksiyonu).'
        : 'General combinational logic synthesized into Look-Up Tables (LUTs).'
    );
  }

  const summary = isTr
    ? `${category} kategorisinde sınıflandırıldı. Tahmini FPGA kaynakları: ${primitives.slice(0, 3).join(', ')}.`
    : `Classified as ${category}. Estimated FPGA primitives: ${primitives.slice(0, 3).join(', ')}.`;

  return {
    title,
    category,
    categoryType,
    summary,
    primitives,
    findings,
    recommendations,
    timingImpact,
    codeSnippet: code.slice(0, 240) + (code.length > 240 ? '...' : '')
  };
}
