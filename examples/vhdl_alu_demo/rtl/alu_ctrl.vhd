library ieee;
use ieee.std_logic_1164.all;
use ieee.std_logic_unsigned.all;

entity alu_ctrl is
    port (
        clk   : in  std_logic;
        rst   : in  std_logic;
        op    : in  std_logic_vector(1 downto 0);
        a     : in  std_logic_vector(7 downto 0);
        b     : in  std_logic_vector(7 downto 0);
        y     : out std_logic_vector(7 downto 0)
    );
end alu_ctrl;

architecture rtl of alu_ctrl is
    signal acc : std_logic_vector(7 downto 0) := (others => '0');
begin
    process(clk)
    begin
        if (clk'event and clk = '1') then
            if (rst = '1') then
                acc <= (others => '0');
            else
                case op is
                    when "00" =>
                        acc <= a + b;
                    when "01" =>
                        acc <= a - b;
                    when "10" =>
                        acc <= a and b;
                    when others =>
                        acc <= a xor b;
                end case;
            end if;
        end if;
    end process;

    y <= acc;
end rtl;
