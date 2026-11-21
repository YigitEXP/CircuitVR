/**
 * RTL Snippet Templates for SystemVerilog / Verilog
 * Curated for beginner RTL engineers to eliminate common syntax and architecture errors.
 * 
 * Complies with strict Engineering Manifesto: ZERO EMOJIS, technical rigor.
 */

export interface RtlSnippet {
  id: string;
  nameTr: string;
  nameEn: string;
  descTr: string;
  descEn: string;
  code: string;
}

export const RTL_SNIPPETS: RtlSnippet[] = [
  {
    id: 'sync_ff',
    nameTr: 'Senkron Resetli always_ff Blogu',
    nameEn: 'Synchronous Reset always_ff Block',
    descTr: 'FPGA icin optimize, kontrol seti paylasimli FDRE yazmaci.',
    descEn: 'FPGA-optimized FDRE register with synchronous reset and clock enable.',
    code: `// Senkron Resetli D-Flip-Flop (FDRE) Yazmac Blogu
always_ff @(posedge clk) begin
  if (!rst_n) begin
    data_reg <= '0;
  end else if (enable) begin
    data_reg <= data_in;
  end
end
`,
  },
  {
    id: 'sipo_shift',
    nameTr: 'Parametrik SIPO Kaydirmali Yazmac (Shift Register)',
    nameEn: 'Parameterized SIPO Shift Register',
    descTr: 'Kaydirma penceresi (Sliding Window) ve dizi atamasi.',
    descEn: 'Sliding window buffer with non-blocking cascaded shift registers.',
    code: `// Parametrik SIPO (Serial-In Parallel-Out) Kaydirmali Yazmac
parameter int KERNEL_SIZE = 3;
parameter int DATA_WIDTH  = 8;

logic [DATA_WIDTH-1:0] shift_reg [0:KERNEL_SIZE-1];

always_ff @(posedge clk) begin
  if (!rst_n) begin
    for (int i = 0; i < KERNEL_SIZE; i++) begin
      shift_reg[i] <= '0;
    end
  end else if (valid_in) begin
    shift_reg[0] <= data_in;
    for (int i = 1; i < KERNEL_SIZE; i++) begin
      shift_reg[i] <= shift_reg[i-1];
    end
  end
end
`,
  },
  {
    id: 'sat_counter',
    nameTr: 'Tasma Korumali Sayac ($clog2 + Saturating Counter)',
    nameEn: 'Saturating Counter with $clog2 Protection',
    descTr: 'Maksimum degere ulasinca tasmayi (0\'a donmeyi) onleyen doymali sayac.',
    descEn: 'Saturating counter preventing overflow wrap-around using $clog2 width.',
    code: `// Tasma Korumali Doymali Sayac (Saturating Counter)
parameter int MAX_COUNT = 15;
localparam int WIDTH    = $clog2(MAX_COUNT + 1);

logic [WIDTH-1:0] counter;

always_ff @(posedge clk) begin
  if (!rst_n) begin
    counter <= '0;
  end else if (count_en) begin
    if (counter < MAX_COUNT) begin
      counter <= counter + 1'b1;
    end else begin
      counter <= MAX_COUNT; // Doyma: Tasmayi (wrap-around) onler
    end
  end
end
`,
  },
  {
    id: 'tb_template',
    nameTr: 'Temel Saat & Reset Uretecli Testbench Iskeleti',
    nameEn: 'Basic Clock & Reset Generator Testbench Skeleton',
    descTr: '100 MHz saat, asenkron/senkron reset ve VCD dump vars hazir sablon.',
    descEn: 'Testbench harness with 100 MHz clock generator, reset pulse and VCD dump.',
    code: `\`timescale 1ns/1ps

module tb_top;
  localparam int CLK_PERIOD = 10; // 100 MHz

  logic clk;
  logic rst_n;

  // 100 MHz Saat Ureteci
  initial clk = 0;
  always #(CLK_PERIOD / 2) clk = ~clk;

  // Reset ve Uyarim Sureci
  initial begin
    $dumpfile("wave.vcd");
    $dumpvars(0, tb_top);

    rst_n = 1'b0;
    #(CLK_PERIOD * 2);
    rst_n = 1'b1; // Reset kaldirildi

    // Test senaryosu buraya
    #(CLK_PERIOD * 10);
    $finish;
  end
endmodule
`,
  },
];
