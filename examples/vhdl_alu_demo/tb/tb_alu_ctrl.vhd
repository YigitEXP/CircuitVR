library ieee;
use ieee.std_logic_1164.all;

entity tb_alu_ctrl is
end tb_alu_ctrl;

architecture sim of tb_alu_ctrl is
    signal clk : std_logic := '0';
    signal rst : std_logic := '1';
    signal op  : std_logic_vector(1 downto 0) := "00";
    signal a   : std_logic_vector(7 downto 0) := X"0A";
    signal b   : std_logic_vector(7 downto 0) := X"03";
    signal y   : std_logic_vector(7 downto 0);
begin
    dut : entity work.alu_ctrl
        port map (
            clk => clk,
            rst => rst,
            op  => op,
            a   => a,
            b   => b,
            y   => y
        );

    clk <= not clk after 5 ns;

    process
    begin
        wait for 12 ns;
        rst <= '0';
        op  <= "00";
        wait for 20 ns;
        op  <= "01";
        wait for 20 ns;
        op  <= "10";
        wait for 20 ns;
        op  <= "11";
        wait for 20 ns;
        wait;
    end process;
end sim;
