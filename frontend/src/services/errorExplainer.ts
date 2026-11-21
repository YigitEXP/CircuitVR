/**
 * RTL Error Explainer & Mentor Service
 * Translates technical error codes and diagnostics from Verilator, Icarus Verilog,
 * Yosys, and cloud fallback into plain human-readable explanations, hardware implications,
 * and fix examples.
 * 
 * Complies with strict Engineering Manifesto: ZERO EMOJIS, technical rigor.
 */

export interface ErrorExplanation {
  ruleCode: string;
  title: string;
  whatHappened: string;
  hardwareMeaning: string;
  correctExample: string;
  severity: 'error' | 'warning' | 'info';
}

export function explainRtlError(message: string, isTr: boolean): ErrorExplanation {
  const msg = message || '';

  // 1. Bit Width Mismatch / Truncation (WIDTHTRUNC, WIDTHEXPAND, Operator ASSIGN expects...)
  if (/WIDTHTRUNC|WIDTHEXPAND|width|bit width|expects \d+ bits.*generates \d+ bits/i.test(msg)) {
    return {
      ruleCode: 'WIDTHTRUNC',
      title: isTr ? 'Bit Genisligi Uyusmazligi (Kirpma/Truncation)' : 'Bit Width Mismatch (Truncation)',
      whatHappened: isTr
        ? 'Atama yapilan sag taraftaki ifadenin bit genisligi, sol taraftaki hedefin bit genisliginden farkli. Fazla bitler donanimda kirpilir (kesilir).'
        : 'The bit width of the right-hand expression does not match the target signal width. Excess high bits are truncated.',
      hardwareMeaning: isTr
        ? 'Ornegin 32-bitlik genel tamsayi sabiti (32\'d10), 2-bitlik bir sayac yazmacina atandiginda ust 30 bit donanimdan atilir. Bu durum beklenmedik erken tasmalara veya tanimsiz sinyal yollarina yol acabilir.'
        : 'Assigning a 32-bit literal to a 2-bit register discards the upper 30 bits. Hardware may overflow prematurely or introduce unexpected logic paths.',
      correctExample: isTr
        ? `// Boyut belirteci kullanarak atama yapin:\nlogic [1:0] counter;\ncounter <= 2'd2; // 32'd2 yerine 2-bit sabit kullanin\n\n// Veya bit dilimleme yapin:\nassign out_8b = in_16b[7:0];`
        : `// Specify explicit bit width:\nlogic [1:0] counter;\ncounter <= 2'd2; // Use explicit 2-bit constant\n\n// Or use explicit slice:\nassign out_8b = in_16b[7:0];`,
      severity: 'warning',
    };
  }

  // 2. Unpacked Array vs Concatenation ({ vs '{)
  if (/UNPACKED|unpacked array|Cannot assign packed|concatenation/i.test(msg)) {
    return {
      ruleCode: 'UNPACKED_ARRAY',
      title: isTr ? 'Paketlenmemis Dizi Atama Hatasi' : 'Unpacked Array Assignment Error',
      whatHappened: isTr
        ? 'SystemVerilog\'da paketlenmemis (unpacked) diziye (orn. logic [7:0] arr [0:2]) deger atarken klasik parantez {} yerine dizi literali \'{} kullanilmalidir.'
        : 'In SystemVerilog, unpacked arrays (e.g. logic [7:0] arr [0:2]) require the array literal syntax \'{} rather than simple concatenation {}.',
      hardwareMeaning: isTr
        ? 'Paketlenmemis diziler silisyum uzerinde bagimsiz Flip-Flop veya Distributed/Block RAM hucrelerine dagitilir; tek parca bir veri hatti degildir. Bu nedenle normal bit birlestirme ({}) donanimsal olarak gecerli bir atama degildir.'
        : 'Unpacked arrays map to discrete registers or RAM cells rather than a single contiguous bus. Standard concatenation ({}) cannot assign across distinct hardware structures.',
      correctExample: isTr
        ? `// Hatali yazim:   arr <= {8'h10, 8'h20, 8'h30};\n// Dogru yazim:    arr <= '{8'h10, 8'h20, 8'h30};\n\n// Tum elemanlari sifirlamak icin:\narr <= '{default: '0};`
        : `// Incorrect:  arr <= {8'h10, 8'h20, 8'h30};\n// Correct:    arr <= '{8'h10, 8'h20, 8'h30};\n\n// Zero-fill all elements:\narr <= '{default: '0};`,
      severity: 'error',
    };
  }

  // 3. Unintended Latch Inferred (LATCH / comb loop)
  if (/LATCH|latch inferred|comb loop|level-sensitive/i.test(msg)) {
    return {
      ruleCode: 'LATCH_INFERRED',
      title: isTr ? 'Istenmeyen Latch (Mantik Mandali) Tespiti' : 'Unintended Latch Inferred',
      whatHappened: isTr
        ? 'Kombinasyonel bir blok (always_comb veya always @(*)) icinde bir sinyale her kosulda (tum if-else veya case durumlarinda) deger atanmamis.'
        : 'A combinational block (always_comb or always @(*)) does not assign a value to a signal under all control branches.',
      hardwareMeaning: isTr
        ? 'Donanim, degeri atanmayan dallarda eski durumu korumak zorunda kalir ve seviye-tetiklemeli Latch (LDCE) uretir. FPGA mimarilerinde Latch kullanimi statik zamanlama analizini (STA) bozar, saat agi kontrolunu zorlastirir ve glik/parazit tetiklenmesine yol acar.'
        : 'Synthesis must infer level-sensitive transparent latches (LDCE) to hold previous states. Latches severely degrade FPGA static timing analysis (STA) and cause glitch susceptibility.',
      correctExample: isTr
        ? `// Cozum: Blok basinda varsayilan deger atayin:\nalways_comb begin\n  next_state = state; // Varsayilan atama (Latch onler)\n  valid_out  = 1'b0;\n  if (enable) begin\n    next_state = S_NEXT;\n    valid_out  = 1'b1;\n  end\nend`
        : `// Solution: Assign default values at the top:\nalways_comb begin\n  next_state = state; // Default assignment prevents latch\n  valid_out  = 1'b0;\n  if (enable) begin\n    next_state = S_NEXT;\n    valid_out  = 1'b1;\n  end\nend`,
      severity: 'error',
    };
  }

  // 4. Blocking Assignment in Sequential Block (BLKSEQ)
  if (/BLKSEQ|blocking assignment in sequential|blocking assignment/i.test(msg)) {
    return {
      ruleCode: 'BLOCKING_IN_SEQ',
      title: isTr ? 'Ardisil Blokta Engellemeli (=) Atama Hatasi' : 'Blocking (=) in Sequential Block',
      whatHappened: isTr
        ? 'Saat kenari tetiklemeli ardisil blokta (always_ff @(posedge clk)) engellemesiz (<=) yerine engellemeli (=) atama operatoru kullanilmis.'
        : 'A clock-edge sequential block (always_ff @(posedge clk)) uses a blocking (=) operator instead of non-blocking (<=).',
      hardwareMeaning: isTr
        ? 'Engellemeli (=) atamalar simülatorde yazmac yerine sirali calisan ara tel gibi davranir ve cevrim ici yaris kosullarina (race condition) yol acar. Simülasyon ile fiziksel FPGA davranisi arasinda uyumsuzluk (synthesis-simulation mismatch) olusur.'
        : 'Blocking assignments cause simulation race conditions across flip-flops, behaving like transient wires rather than registers. This triggers severe synthesis-simulation mismatches.',
      correctExample: isTr
        ? `// Hatali:  always_ff @(posedge clk) q = d;\n// Dogru:   always_ff @(posedge clk) q <= d;`
        : `// Incorrect: always_ff @(posedge clk) q = d;\n// Correct:   always_ff @(posedge clk) q <= d;`,
      severity: 'warning',
    };
  }

  // 5. Non-blocking Assignment in Combinational Block (COMBDLY)
  if (/COMBDLY|non-blocking in comb|non-blocking/i.test(msg)) {
    return {
      ruleCode: 'NONBLOCKING_IN_COMB',
      title: isTr ? 'Kombinasyonel Blokta (<=) Kullanimi' : 'Non-blocking (<=) in Comb Block',
      whatHappened: isTr
        ? 'Kombinasyonel blok (always_comb) icinde engellemeli (=) yerine saatli yazmac operatoru (<=) kullanilmis.'
        : 'A combinational block (always_comb) uses non-blocking assignment (<=) instead of blocking (=).',
      hardwareMeaning: isTr
        ? 'Kombinasyonel mantik kapilari anlik yayilim gecikmesiyle calisir, saat darbesini beklemez. (<=) operatoru simülatorde gereksiz delta-cycle olaylari tetikler ve gecikme modeli olusturur.'
        : 'Combinational logic evaluates instantaneously with gate propagation delay. Using <= causes extra simulation delta cycles and misleading timing behavior.',
      correctExample: isTr
        ? `// Hatali:  always_comb out <= a & b;\n// Dogru:   always_comb out = a & b;`
        : `// Incorrect: always_comb out <= a & b;\n// Correct:   always_comb out = a & b;`,
      severity: 'warning',
    };
  }

  // 6. Incomplete Case Statement (CASEINCOMPLETE)
  if (/CASEINCOMPLETE|missing default|incomplete case/i.test(msg)) {
    return {
      ruleCode: 'INCOMPLETE_CASE',
      title: isTr ? 'Eksik Case / Default Bildirimi' : 'Incomplete Case / Missing Default',
      whatHappened: isTr
        ? 'case ifadesinde secici sinyalin olasi tum kombinasyonlari listelenmemis ve default: dali yazilmamis.'
        : 'The case statement does not enumerate all selector combinations and lacks a default: branch.',
      hardwareMeaning: isTr
        ? 'Secicinin tanimlanmayan bir degere (veya X/Z belirsizligine) ulasmasi durumunda cikisin ne olacagi belirtilmedigi icin istenmeyen Latch veya oncelikli cozucu devresi sentezlenir.'
        : 'Undefined selector values or X/Z states force synthesis to infer latches or unbalanced priority decoders.',
      correctExample: isTr
        ? `case (sel)\n  2'b00: y = data_a;\n  2'b01: y = data_b;\n  default: y = 2'b00; // Her zaman default ekleyin\nendcase`
        : `case (sel)\n  2'b00: y = data_a;\n  2'b01: y = data_b;\n  default: y = 2'b00; // Always provide default\nendcase`,
      severity: 'warning',
    };
  }

  // 7. Multiple Drivers on Net (MULTIDRIVEN)
  if (/MULTIDRIVEN|multiple drivers|multiple concurrent/i.test(msg)) {
    return {
      ruleCode: 'MULTIPLE_DRIVERS',
      title: isTr ? 'Ayni Hatta Coklu Surucu (Kisa Devre) Hatasi' : 'Multiple Drivers on Net (Contention)',
      whatHappened: isTr
        ? 'Ayni sinyale birden fazla always blogundan veya ayni anda hem assign hem always icinden deger atanmaya calisiliyor.'
        : 'A net is being concurrently driven by multiple always blocks or simultaneous assign statements.',
      hardwareMeaning: isTr
        ? 'Silisyum uzerinde iki ayri kapi cikisinin ayni kabloya kisa devre yapmasidir. FPGA donaniminda asiri akim, sinyal catismasi (contention) veya sentez motoru reddine neden olur.'
        : 'Direct hardware contention where two physical gate outputs short-circuit the same wire, causing extreme routing conflicts or silicon damage.',
      correctExample: isTr
        ? `// Cozum: Tum atamalari tek bir always blogu altinda toplayin:\nalways_ff @(posedge clk) begin\n  if (cond_a) q <= data_a;\n  else if (cond_b) q <= data_b;\nend`
        : `// Solution: Consolidate drives into a single always block:\nalways_ff @(posedge clk) begin\n  if (cond_a) q <= data_a;\n  else if (cond_b) q <= data_b;\nend`,
      severity: 'error',
    };
  }

  // 8. Undeclared / Implicit Wire (IMPLICIT)
  if (/IMPLICIT|implicit wire|undeclared|not declared/i.test(msg)) {
    return {
      ruleCode: 'IMPLICIT_WIRE',
      title: isTr ? 'Bildirilmemis Ortuk Tel (Implicit Wire)' : 'Implicit / Undeclared Net',
      whatHappened: isTr
        ? 'Tanimlanmamis bir sinyal adi koddaki bir atamada veya modul baglantisinda kullanilmis.'
        : 'An undeclared identifier is used in an assignment or module instantiation port connection.',
      hardwareMeaning: isTr
        ? 'Verilog, tanimlanmayan sinyalleri 1-bitlik tel (wire) kabul eder. Eger sinyaliniz aslinda cok-bitli bir veri yolu ise ust bitler kaybolur ve devre yanlis calisir.'
        : 'Verilog defaults undeclared signals to 1-bit wires. If the intention was a multi-bit bus, high bits are silent drops causing hardware malformation.',
      correctExample: isTr
        ? `// Sinyali kullanmadan once acikca tanimlayin:\nlogic [7:0] my_signal;\nassign my_signal = data_in + 1'b1;`
        : `// Explicitly declare the signal with proper width:\nlogic [7:0] my_signal;\nassign my_signal = data_in + 1'b1;`,
      severity: 'warning',
    };
  }

  // 9. Syntax Error / Missing Punctuation
  if (/syntax error|unexpected|noktali virgul|parantez/i.test(msg)) {
    return {
      ruleCode: 'SYNTAX_ERROR',
      title: isTr ? 'HDL Sozdizimi Hatasi (Noktalama / Parantez)' : 'HDL Syntax Error (Punctuation/Bracket)',
      whatHappened: isTr
        ? 'Satir sonunda noktalı virgul (;) unutulmus, parantezler eslesmemis veya pes pese hatali noktalama (orn. `<= data;,`) yapilmis.'
        : 'Missing semicolon (;), unmatched parenthesis/bracket, or stray duplicate punctuation (e.g. `<= data;,`).',
      hardwareMeaning: isTr
        ? 'Derleyici ve sentez motoru HDL dil kuralini cozemediği icin Soyut Sozdizimi Agacini (AST) insa edemez ve devre sentezlenemez.'
        : 'The parser cannot construct the Abstract Syntax Tree (AST), aborting the synthesis and elaboration pipeline.',
      correctExample: isTr
        ? `// Her bildirimin sonunu tek bir noktali virgul ile kapatin:\nassign result = a + b;\n\n// if kosullarini daima parantez icine alin:\nif (valid_in) begin ... end`
        : `// Terminate statements with a single semicolon:\nassign result = a + b;\n\n// Always enclose if conditions in parentheses:\nif (valid_in) begin ... end`,
      severity: 'error',
    };
  }

  // Fallback Generic Diagnostic
  return {
    ruleCode: 'RTL_DIAGNOSTIC',
    title: isTr ? 'RTL Dogrulama Uyarisi' : 'RTL Verification Notice',
    whatHappened: isTr
      ? `Derleyici uyarisi tespit edildi: ${msg}`
      : `Compiler diagnostic reported: ${msg}`,
    hardwareMeaning: isTr
      ? 'Bu uyari FPGA uzerinde beklenmeyen zamanlama sapmalarina, optimizasyon budamalarina veya mantik seviyesi uyumsuzluklarina isaret edebilir.'
      : 'This diagnostic may signal unexpected timing drift, aggressive logic pruning, or logic-level discrepancies on FPGA silicon.',
    correctExample: isTr
      ? '// Koddaki ilgili satiri ve port genisliklerini kontrol edin.'
      : '// Inspect the corresponding line and port widths in your code.',
    severity: 'info',
  };
}
