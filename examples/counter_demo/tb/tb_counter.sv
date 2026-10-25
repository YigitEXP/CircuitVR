`timescale 1ns/1ps
module tb_counter;
    logic       clk = 0, rst_n = 0, en = 0;
    logic [3:0] count;

    counter #(.WIDTH(4)) dut (.clk(clk), .rst_n(rst_n), .en(en), .count(count));

    always #5 clk = ~clk;

    initial begin
        #22 rst_n = 1;
        #10 en = 1;
        #200 en = 0;
        #40 $finish;
    end
endmodule
