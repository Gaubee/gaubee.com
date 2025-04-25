# The Runtime

In the previous chapter we built the classical counter interface using iced and The Elm Architecture. We focused on each
fundamental part—one at a time: **state**, **messages**, **update logic**, and **view logic**.

But now what? Yes, we have all the fundamental parts of a user interface—as we learned during
[our dissection](architecture.md)—but it is unclear how we are supposed to bring it to life.

It seems we are missing _something_ that can put all the parts together and _run_ them in unison. _Something_ that
creates and runs the fundamental loop of a user interface—displaying widgets to a user and reacting to any interactions.

This _something_ is called the **runtime**. You can think of it as the environment where the feedback loop of a user
interface takes place. The runtime is in charge of every part of the loop: initializing the **state**,
producing **messages**, executing the **update logic**, and running our **view logic**.

<div align="center">
  <img alt="The Runtime" src="resources/the-runtime.svg">
</div>

> Another way to picture the runtime is by imagining a huge engine with four fundamental parts missing. Our job is
> to fill in these parts—and then the engine can run!

## A Magical Runtime

Let's try to get a better understanding of the lifetime of an interface by exploring the internals of a basic (although very magical!) runtime.

In fact, we have actually started writing a runtime already! When [we implemented the update logic of our counter](first-steps.md#update-logic),
we wrote a very small test that simulated a user:

```rust,ignore
#[test]
fn it_counts_properly() {
    let mut counter = Counter { value: 0 };

    counter.update(Message::Increment);
    counter.update(Message::Increment);
    counter.update(Message::Decrement);

    assert_eq!(counter.value, 1);
}
```

This is technically a very bare-bones runtime. It initializes the **state**, produces some **interactions**,
and executes the **update logic**.

Of course, the interactions are made up, it is very short-lived, and there is no **view logic**
involved—far from what we actually want. Still, it's a great start! Let's try to extend it, step by step.

### Initializing the State

Our small runtime is already initializing the application state properly:

```rust,ignore
// Initialize the state
let mut counter = Counter { value: 0 };
```

However, we can avoid hardcoding the initial state by leveraging the `Default` trait. Let's just derive it:

```rust
#[derive(Default)]
struct Counter {
    value: i64
}
```

And then, we simply use `Counter::default` in our runtime:

```rust,ignore
// Initialize the state
let mut counter = Counter::default();
```

The difference may be subtle, but we are separating concerns—we keep the initial state of our application close to
the state definition and separated from the runtime. This way, we may eventually be able to make our runtime work with
_any_ application!

### Displaying the Interface

Alright! We have our **state** initialized. What's next? Well, before a user can **interact** with our interface, we
need to **display** it to them.

That's easy! We just need to open a window in whatever OS the user is running, initialize a proper graphics backend,
and then render the widgets returned by our **view logic**—properly laid out, of course!

What? You have no clue of how to do that? Don't worry, I have this magical function: `display`. It takes a reference to
any interface and displays it to the user. It totally works!

```rust,ignore
use magic::display;

# // Initialize the state
# let mut counter = Counter::default();
#
// Run our view logic to obtain our interface
let interface = counter.view();

// Display the interface to the user
display(&interface);
```

See? Easy! Jokes aside, the purpose of this chapter is not for us to learn graphics programming; but for us
to get a better understanding of how a runtime works. A little bit of magic doesn't hurt!

### Gathering the Interactions

The user is seeing our interface and is now interacting with it. We need to pay very good attention to all
the interactions and produce all the relevant **messages** that our widgets specify.

How? With some more magic, of course! I just found this `interact` function inside of my top hat—it takes an
interface and produces the **messages** that correspond to the latest interactions of the user.

```rust,ignore
use magic::{display, interact};

# // Initialize the state
# let mut counter = Counter::default();
#
# // Run our view logic to obtain our interface
# let interface = counter.view();
#
# // Display the interface to the user
# display(&interface);
#
// Process the user interactions and obtain our messages
let messages = interact(&interface);
```

Great! `interact` returns a list of **messages** for us—ready to be iterated.

### Reacting to the Interactions

At this point, we have gathered the user interactions and we have turned them into a bunch of **messages**. In order to
react properly to the user, we need to update our **state** accordingly for each message.

Luckily, there are no more magic tricks involved in this step—we can just use our **update logic**:

```rust,ignore
# use magic::{display, interact};
#
# // Initialize the state
# let mut counter = Counter::default();
#
# // Run our view logic to obtain our interface
# let interface = counter.view();
#
# // Display the interface to the user
# display(&interface);
#
# // Process the user interactions and obtain our messages
# let messages = interact(&interface);
#
// Update our state by processing each message
for message in messages {
    counter.update(message);
}
```

That should keep our state completely up-to-date with the latest user interactions.

### Looping Around

Okay! Our state has been updated to reflect the user interactions. Now, we need to display the resulting interface again
to the user. And after that, we must process any further interactions... And then, update our state once more.
And then... Do it all over once again!

This is a loop! And no, loops aren't very magical—not when we write Rust, at least:

```rust,ignore
use magic::{display, interact};

// Initialize the state
let mut counter = Counter::default();

// Be interactive. All the time!
loop {
    // Run our view logic to obtain our interface
    let interface = counter.view();

    // Display the interface to the user
    display(&interface);

    // Process the user interactions and obtain our messages
    let messages = interact(&interface);

    // Update our state by processing each message
    for message in messages {
        counter.update(message);
    }
}
```

Congratulations! We just wrote a perfectly functional runtime—magical properties aside. We can clearly understand here how
each fundamental part of The Elm Architecture fits in the lifetime of an application.

Specifically,

- **state** is initialized once,
- **view logic** runs once at startup and then after every batch of interactions,
- and **update logic** runs for every interaction that created a **message**.

## The Ice Wizard

"That's cool and all", you say, "but I am not a wizard and I still have no clue of how to run the counter interface I wrote.
I have things to count!"

Fair enough! iced implements a very similar runtime to the one we just built. It comes bundled with
its own magic[^magic]—so you don't need to worry about learning the dark arts yourself.

If we want to run our `Counter`, all we have to do is call [`run`]:

```rust,ignore,iced(height=100px)
# use iced::widget::{button, column, text, Column};
#
pub fn main() -> iced::Result {
    iced::run("A cool counter", Counter::update, Counter::view)
}
#
# #[derive(Default)]
# struct Counter {
#     value: i64,
# }
#
# #[derive(Debug, Clone, Copy)]
# enum Message {
#     Increment,
#     Decrement,
# }
#
# impl Counter {
#     fn update(&mut self, message: Message) {
#         match message {
#             Message::Increment => {
#                 self.value += 1;
#             }
#             Message::Decrement => {
#                 self.value -= 1;
#             }
#         }
#     }
#
#     fn view(&self) -> Column<Message> {
#         column![
#             button("+").on_press(Message::Increment),
#             text(self.value),
#             button("-").on_press(Message::Decrement),
#         ]
#     }
# }
```

We just give our application a _cool_ title and then provide the **update logic** and **view logic** to
the **runtime**—which then figures out the rest!

The runtime is capable of inferring the types for the **state** and **messages** out of the type signatures of
our **update logic** and **view logic**. The **state** is initialized leveraging `Default`, as we described earlier.

Notice also that [`run`] can fail and, therefore, it returns an [`iced::Result`]. If all we are doing is run the
application, we can return this result directly in `main`.

And that should be it! Have fun counting things for 300 million years—at least!

[`run`]: https://docs.iced.rs/iced/fn.run.html
[`iced::Result`]: https://docs.iced.rs/iced/type.Result.html

[^magic]: Mainly [`winit`], [`softbuffer`], [`wgpu`], [`tiny-skia`], and [`cosmic-text`].

[`winit`]: https://github.com/rust-windowing/winit
[`softbuffer`]: https://github.com/rust-windowing/softbuffer
[`wgpu`]: https://github.com/gfx-rs/wgpu
[`tiny-skia`]: https://github.com/RazrFalcon/tiny-skia
[`cosmic-text`]: https://github.com/pop-os/cosmic-text

> #### Note From the Author
>
> You reached the end of the book, for now!
>
> I think it should already serve as a quick introduction to the basics of the library.
> There is a lot more to unravel—but hopefully you are now at a point where you can start
> playing around, having fun, and experimenting further.
>
> The book is far from finished—there are a lot more topics I want to cover here, namely:
>
> - Layout
> - Styling
> - Concurrency
> - Scaling Applications
> - Extending the Runtime
> - And More!
>
> Until I get to write them, check out the [Additional Resources](additional-resources.md)
> chapter if you want to explore and learn further.
>
> I hope that you enjoyed the read so far. Stay tuned!
>
> — Héctor
