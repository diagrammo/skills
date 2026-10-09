mod greet;
mod shout;

use crate::greet::greet;

fn main() {
    println!("{}", shout::shout(&greet("world")));
}
